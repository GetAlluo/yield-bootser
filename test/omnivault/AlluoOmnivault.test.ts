import { expect } from "chai";
import { ethers, network, upgrades } from "hardhat";
import { BigNumber } from "ethers";

import { AlluoOmnivault, AlluoOmnivault__factory, Exchange, IERC20MetadataUpgradeable } from "../../typechain-types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
function generateRandomNumber(min: number, max: number): number {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
describe("Omnivault Tests", function () {
    let omnivault: AlluoOmnivault;
    let signers: SignerWithAddress[];
    let usdc: IERC20MetadataUpgradeable, weth: IERC20MetadataUpgradeable;
    let mooLp1: IERC20MetadataUpgradeable, mooLp2: IERC20MetadataUpgradeable, mooLp3: IERC20MetadataUpgradeable;
    let exchange: Exchange;
    let admin: SignerWithAddress;
    const tolerance = 1e15; // Adjust the tolerance value as needed

    // Existing setup support:
    // https://app.beefy.com/vault/curve-op-f-susd
    // https://app.beefy.com/vault/stargate-op-usdc
    // https://app.beefy.com/vault/hop-op-usdc
    beforeEach(async () => {
        await network.provider.request({
            method: "hardhat_reset",
            params: [{
                forking: {
                    enabled: true,
                    jsonRpcUrl: process.env.OPTIMISM_FORKING_URL as string,
                    //you can fork from last block by commenting next line
                    blockNumber: 87237321,
                },
            },],
        });
        const omniVaultFactory: AlluoOmnivault__factory = await ethers.getContractFactory(
            "AlluoOmnivault"
        );
        signers = await ethers.getSigners();

        usdc = await ethers.getContractAt("IERC20MetadataUpgradeable", "0x7F5c764cBc14f9669B88837ca1490cCa17c31607")
        mooLp1 = await ethers.getContractAt('IERC20MetadataUpgradeable', '0x107Dbf9c9C0EF2Df114159e5C7DC2baf7C444cFF');
        mooLp2 = await ethers.getContractAt("IERC20MetadataUpgradeable", "0xe536F8141D8EB7B1f096934AF3329cB581bFe995");
        mooLp3 = await ethers.getContractAt("IERC20MetadataUpgradeable", "0xE2f035f59De6a952FF699b4EDD0f99c466f25fEc");
        weth = await ethers.getContractAt("IERC20MetadataUpgradeable", "0x4200000000000000000000000000000000000006")
        exchange = await ethers.getContractAt("Exchange", "0x66Ac11c106C3670988DEFDd24BC75dE786b91095")
        admin = signers[19];
        omnivault = (await upgrades.deployProxy(omniVaultFactory, [
            exchange.address,
            usdc.address,
            [mooLp1.address],
            [100],
            [ethers.constants.AddressZero],
            admin.address,
            0,
            600
        ], {
            initializer: "initialize",
        })) as AlluoOmnivault;

        let usdWhale = await ethers.getImpersonatedSigner("0xebe80f029b1c02862b9e8a70a7e5317c06f62cae")
        // Send 1 eth to the whale
        await signers[0].sendTransaction({ to: usdWhale.address, value: ethers.utils.parseEther("1") })
        for (let i = 0; i < 10; i++) {
            await usdc.connect(usdWhale).transfer(signers[i].address, ethers.utils.parseUnits("100000", 6))
        }
    });
    describe("Core functions of the vaults", function () {
        it("Deposit when there is only 1 moo LP vault. All funds should go to that Moo vault.", async function () {
            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("100", 6));
            await omnivault.connect(signers[0]).deposit(usdc.address, ethers.utils.parseUnits("100", 6));
            expect(await mooLp1.balanceOf(omnivault.address)).greaterThan(0);
            expect(await usdc.balanceOf(omnivault.address)).equal(0);
        });
        it("Withdraw when there is only 1 moo LP vault. All funds should go back to the user in USDC.", async function () {
            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("100", 6));
            await omnivault.connect(signers[0]).deposit(usdc.address, ethers.utils.parseUnits("100", 6));
            let signerUSDCBalanceBeforeWithdrawal = await usdc.balanceOf(signers[0].address);

            await omnivault.connect(signers[0]).withdraw(usdc.address, 100);
            // Should equal zero because signer is the only depositor
            expect(await mooLp1.balanceOf(omnivault.address)).to.equal(0);
            expect(signerUSDCBalanceBeforeWithdrawal).lessThan(await usdc.balanceOf(signers[0].address));
            expect(await usdc.balanceOf(omnivault.address)).equal(0);

        })
        it("Trying to withdraw more than 100% should revert", async function () {
            await expect(omnivault.connect(signers[0]).withdraw(usdc.address, 101)).to.be.revertedWith("!LTE100")
        })
        it("Trying to withdraw 0% should revert", async function () {
            await expect(omnivault.connect(signers[0]).withdraw(usdc.address, 0)).to.be.revertedWith("!GT0")
        })
        it("Depositing zero amounts should revert", async function () {
            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("100", 6));
            await expect(omnivault.connect(signers[0]).deposit(usdc.address, 0)).to.be.revertedWith("!GT0")
        })


        it("Multiple depositors should be able to deposit and then withdraw fully. All funds should go back to the user in USDC.", async function () {
            for (let i = 0; i < 5; i++) {
                await usdc.connect(signers[i]).approve(omnivault.address, ethers.utils.parseUnits("100", 6));
                await omnivault.connect(signers[i]).deposit(usdc.address, ethers.utils.parseUnits("100", 6));
            }
            for (let i = 0; i < 5; i++) {
                await omnivault.connect(signers[i]).withdraw(usdc.address, 100);
            }
            expect(await mooLp1.balanceOf(omnivault.address)).to.equal(0);
            expect(await usdc.balanceOf(omnivault.address)).equal(0);

        })
        it("Depositing in non primary token should work", async function () {
            // First swap some usdc to WETH
            await usdc.connect(signers[0]).approve(exchange.address, ethers.utils.parseUnits("1000", 6));
            await exchange.connect(signers[0]).exchange(usdc.address, weth.address, ethers.utils.parseUnits("1000", 6), 0);
            let wethBalance = await weth.balanceOf(signers[0].address);
            await weth.connect(signers[0]).approve(omnivault.address, wethBalance);
            await omnivault.connect(signers[0]).deposit(weth.address, wethBalance);
            expect(await mooLp1.balanceOf(omnivault.address)).greaterThan(0);
            expect(await weth.balanceOf(omnivault.address)).equal(0);
        })

        it("Withdrawing in non primary token should work", async function () {
            // First swap some usdc to WETH
            await usdc.connect(signers[0]).approve(exchange.address, ethers.utils.parseUnits("1000", 6));
            await exchange.connect(signers[0]).exchange(usdc.address, weth.address, ethers.utils.parseUnits("1000", 6), 0);
            let wethBalance = await weth.balanceOf(signers[0].address);
            await weth.connect(signers[0]).approve(omnivault.address, wethBalance);
            await omnivault.connect(signers[0]).deposit(weth.address, wethBalance);
            await omnivault.connect(signers[0]).withdraw(weth.address, 100);
            expect(await mooLp1.balanceOf(omnivault.address)).to.equal(0);
            expect(await weth.balanceOf(omnivault.address)).equal(0);
        })

        it("Test depositing into an omnivault with multiple moo vaults", async function () {
            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("100", 6));
            await omnivault.connect(signers[0]).deposit(usdc.address, ethers.utils.parseUnits("100", 6));
            await omnivault.connect(admin).redistribute([mooLp1.address, mooLp2.address, mooLp3.address], [33, 33, 33], [ethers.constants.AddressZero, ethers.constants.AddressZero, ethers.constants.AddressZero]);
            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("100", 6));
            await omnivault.connect(signers[0]).deposit(usdc.address, ethers.utils.parseUnits("100", 6));
            expect(await mooLp1.balanceOf(omnivault.address)).greaterThan(0);
            expect(await usdc.balanceOf(omnivault.address)).equal(0);
        })

        // Use mocks separately to test checking the mappings and enumerable sets directly. This comes later.
    })


    describe("Redistribution tests", function () {
        it("Remain in same vault. Should do nothing since this vault isn't boosted (separate tests for boosted rewards", async function () {
            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("100", 6));
            await omnivault.connect(signers[0]).deposit(usdc.address, ethers.utils.parseUnits("100", 6));
            let mooLp1TokensBefore = await mooLp1.balanceOf(omnivault.address);
            await omnivault.connect(admin).redistribute([], [], []);
            let mooLp1Tokens = await mooLp1.balanceOf(omnivault.address);
            expect(mooLp1TokensBefore).to.equal(mooLp1Tokens);
        })

        it("Redistribution with incorrect params should revert", async function () {
            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("100", 6));
            await omnivault.connect(signers[0]).deposit(usdc.address, ethers.utils.parseUnits("100", 6));
            await expect(omnivault.connect(admin).redistribute([mooLp2.address], [], [ethers.constants.AddressZero])).to.be.revertedWith("Mismatch in vaults and percents lengths")
        })
        it("Redistribution from mooVault1 --> mooVault2", async function () {
            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("100", 6));
            await omnivault.connect(signers[0]).deposit(usdc.address, ethers.utils.parseUnits("100", 6));
            let mooLp2TokensBefore = await mooLp2.balanceOf(omnivault.address);
            await omnivault.connect(admin).redistribute([mooLp2.address], [100], [ethers.constants.AddressZero]);
            let mooLp2Tokens = await mooLp2.balanceOf(omnivault.address);
            expect(mooLp2TokensBefore).to.equal(0);
            expect(Number(mooLp2Tokens)).greaterThan(Number(mooLp2TokensBefore));

        })
        it("Redistribution from mooVault1 --> mooVault2 and mooVault3 in even proportion", async function () {
            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("100", 6));
            await omnivault.connect(signers[0]).deposit(usdc.address, ethers.utils.parseUnits("100", 6));
            let mooLp2TokensBefore = await mooLp2.balanceOf(omnivault.address);
            let mooLp3TokensBefore = await mooLp3.balanceOf(omnivault.address);
            await omnivault.connect(admin).redistribute([mooLp2.address, mooLp3.address], [50, 50], [ethers.constants.AddressZero, ethers.constants.AddressZero]);
            let mooLp2Tokens = await mooLp2.balanceOf(omnivault.address);
            let mooLp3Tokens = await mooLp3.balanceOf(omnivault.address);
            expect(mooLp2TokensBefore).to.equal(0);
            expect(mooLp3TokensBefore).to.equal(0);
            expect(Number(mooLp2Tokens)).greaterThan(Number(mooLp2TokensBefore));
            expect(Number(mooLp3Tokens)).greaterThan(Number(mooLp3TokensBefore));

        })
        it("Redistribution from mooVault1 --> 33% of each mooVault1, mooVault2 and mooVault3", async function () {
            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("100", 6));
            await omnivault.connect(signers[0]).deposit(usdc.address, ethers.utils.parseUnits("100", 6));
            let mooLp1TokensBefore = await mooLp1.balanceOf(omnivault.address);
            let mooLp2TokensBefore = await mooLp2.balanceOf(omnivault.address);
            let mooLp3TokensBefore = await mooLp3.balanceOf(omnivault.address);

            await omnivault.connect(admin).redistribute([mooLp1.address, mooLp2.address, mooLp3.address], [33, 33, 33], [ethers.constants.AddressZero, ethers.constants.AddressZero, ethers.constants.AddressZero]);
            let mooLp1Tokens = await mooLp1.balanceOf(omnivault.address);
            let mooLp2Tokens = await mooLp2.balanceOf(omnivault.address);
            let mooLp3Tokens = await mooLp3.balanceOf(omnivault.address);

            //Existing allocation of mooLp1
            expect(Number(mooLp1TokensBefore)).greaterThan(0)
            expect(mooLp2TokensBefore).to.equal(0);
            expect(mooLp3TokensBefore).to.equal(0);

            expect(Number(mooLp1Tokens)).lessThan(Number(mooLp1TokensBefore));
            expect(Number(mooLp2Tokens)).greaterThan(Number(mooLp2TokensBefore));
            expect(Number(mooLp3Tokens)).greaterThan(Number(mooLp3TokensBefore));

        })
    })
    describe("Integration testing by simulating rising LP value", function () {
        it("Simulate these LPs rising in value", async function () {
            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("1000", 6));
            await omnivault.connect(signers[0]).deposit(usdc.address, ethers.utils.parseUnits("1000", 6));
            let totalFunds = await mooLp1.balanceOf(omnivault.address);
            let simulatedWithdrawValueBefore = await omnivault.connect(signers[0]).callStatic.withdraw(usdc.address, 100);
            await simulateIncreasedValueOfLP(mooLp1.address, ethers.utils.parseEther("5"), mooLp1.address);
            // The LPs should be worth more, let's check this.
            let simulatedWithdrawValueAfter = await omnivault.connect(signers[0]).callStatic.withdraw(usdc.address, 100);
            let totalFundsAfter = await mooLp1.balanceOf(omnivault.address);
            expect(Number(simulatedWithdrawValueAfter)).greaterThan(Number(simulatedWithdrawValueBefore));
            // These numbers should be equal, to check that the vault is purely only gaining value from the LPs
            expect(totalFundsAfter).to.equal(totalFunds);
        })
        it("Multiple depositors should receive more USDC when the LPs rise enough in value (accounting for slippage, fees)", async function () {
            let amountIn = ethers.utils.parseUnits("1000", 6);
            for (let i = 0; i < 5; i++) {
                await usdc.connect(signers[i]).approve(omnivault.address, amountIn);
                await omnivault.connect(signers[i]).deposit(usdc.address, amountIn);
            }
            await simulateIncreasedValueOfLP(mooLp1.address, ethers.utils.parseEther("5"), mooLp1.address);
            for (let i = 0; i < 5; i++) {
                let balUsdcBefore = await usdc.balanceOf(signers[i].address);
                await omnivault.connect(signers[i]).withdraw(usdc.address, 100);
                let balUsdcAfter = await usdc.balanceOf(signers[i].address);
                let amountOut = balUsdcAfter.sub(balUsdcBefore);
                expect(Number(amountOut)).greaterThan(Number(amountIn));
            }
        })

        it("We should be able to track the performance of the vault overtime using an account that deposits an initial 1% amount", async function () {
            let amountIn = ethers.utils.parseUnits("1000", 6);
            await usdc.connect(signers[0]).approve(omnivault.address, amountIn);
            await omnivault.connect(signers[0]).deposit(usdc.address, amountIn);
            for (let i = 0; i < 10; i++) {
                let randomReward = generateRandomNumber(1, 15);
                await simulateIncreasedValueOfLP(mooLp1.address, ethers.utils.parseEther(String(randomReward)), mooLp1.address);
                console.log("Value of investment", Number(await omnivault.connect(signers[0]).callStatic.withdraw(usdc.address, 100)) / 1000000);
            }
        })
    })

    describe("Test to check fee collection", function () {

        it("Should result in NO fee collection as fees are set to zero", async function () {
            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("1000", 6));
            await omnivault.connect(signers[0]).deposit(usdc.address, ethers.utils.parseUnits("1000", 6));
            await simulateIncreasedValueOfLP(mooLp1.address, ethers.utils.parseEther("10"), mooLp1.address);
            let adminUSDCBalanceBefore = await usdc.balanceOf(admin.address);
            await omnivault.connect(signers[0]).withdraw(usdc.address, 100)
            expect(await usdc.balanceOf(admin.address)).to.be.equal(adminUSDCBalanceBefore);
        })
        it("Should result in fee collection for full withdrawals", async function () {
            await omnivault.connect(signers[19]).setFeeOnYield(1000);

            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("1000", 6));
            await omnivault.connect(signers[0]).deposit(usdc.address, ethers.utils.parseUnits("1000", 6));
            await simulateIncreasedValueOfLP(mooLp1.address, ethers.utils.parseEther("10"), mooLp1.address);
            // Skip some time to force fee skimming
            await ethers.provider.send("evm_increaseTime", [700]);
            await omnivault.connect(signers[0]).withdraw(usdc.address, 100)
            console.log(await omnivault.adminFees(usdc.address), "Fee collected")
            expect(Number(await omnivault.adminFees(usdc.address))).to.be.greaterThan(0);

        })


        it("If fee is 100% on yield, the user should only receive back the principal", async function () {
            await omnivault.connect(signers[19]).setFeeOnYield(10000);

            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("1000", 6));
            await omnivault.connect(signers[0]).deposit(usdc.address, ethers.utils.parseUnits("1000", 6));
            await simulateIncreasedValueOfLP(mooLp1.address, ethers.utils.parseEther("10"), mooLp1.address);
            let userUSDCBalanceBefore = await usdc.balanceOf(signers[0].address);
            // Skip some time to force fee skimming
            await ethers.provider.send("evm_increaseTime", [700]);
            await omnivault.connect(signers[0]).withdraw(usdc.address, 100)
            let userUSDCBalanceAfter = await usdc.balanceOf(signers[0].address);
            console.log(await omnivault.adminFees(usdc.address), "Fee collected")

            expect(Number(await omnivault.adminFees(usdc.address))).to.be.greaterThan(0);
            // Allow margin of error for slippage. But the user should not have received more than the principal

            expect(Number(userUSDCBalanceAfter.sub(userUSDCBalanceBefore))).to.be.closeTo(Number(ethers.utils.parseUnits("1000", 6)), 10000000);


        })

        // These are complex tests to make sure fee collection works as expected
        it("Harvest fees, and make sure the balance of moo lps correspond to the depositor balances correctly with 1 moo vault", async function () {
            await omnivault.connect(signers[19]).setFeeOnYield(1000);
            for (let i = 0; i < 10; i++) {
                await usdc.connect(signers[i]).approve(omnivault.address, ethers.utils.parseUnits("1000", 6));
                await omnivault.connect(signers[i]).deposit(usdc.address, ethers.utils.parseUnits("1000", 6));
            }
            await simulateIncreasedValueOfLP(mooLp1.address, ethers.utils.parseEther("10"), mooLp1.address);
            // Skip some time to force fee skimming
            await ethers.provider.send("evm_increaseTime", [700]);
            await omnivault.skimYieldFeeAndSendToAdmin();

            let allActiveUsers = await omnivault.getActiveUsers();
            let mooLp1BalanceBefore = await mooLp1.balanceOf(omnivault.address);
            let mooLp2BalanceBefore = await mooLp2.balanceOf(omnivault.address);
            let mooLp3BalanceBefore = await mooLp3.balanceOf(omnivault.address);

            let mooLpCounter1 = 0;
            let mooLpCounter2 = 0;
            let mooLpCounter3 = 0;
            for (let i = 0; i < allActiveUsers.length; i++) {
                let balanceArrays = await omnivault.balanceOf(allActiveUsers[i]);
                let balances = balanceArrays[1];
                let vaults = balanceArrays[0];
                for (let j = 0; j < balanceArrays[0].length; j++) {
                    if (vaults[j] == mooLp1.address && Number(balances[j]) > 0) {
                        mooLpCounter1 += Number(balances[j]);
                    }
                    if (vaults[j] == mooLp2.address && Number(balances[j]) > 0) {
                        mooLpCounter2 += Number(balances[j]);
                    }
                    if (vaults[j] == mooLp3.address && Number(balances[j]) > 0) {
                        mooLpCounter3 += Number(balances[j]);
                    }
                }

            }
            expect(Number(mooLpCounter1)).to.be.closeTo(Number(mooLp1BalanceBefore), tolerance);
            expect(Number(mooLpCounter2)).to.be.closeTo(Number(mooLp2BalanceBefore), tolerance);
            expect(Number(mooLpCounter3)).to.be.closeTo(Number(mooLp3BalanceBefore), tolerance);
        })


        it("Harvest fees, and make sure the balance of moo lps correspond to the depositor balances correctly with 3 moo vault", async function () {
            await omnivault.connect(signers[19]).setFeeOnYield(1000);
            for (let i = 0; i < 10; i++) {
                await usdc.connect(signers[i]).approve(omnivault.address, ethers.utils.parseUnits("1000", 6));
                await omnivault.connect(signers[i]).deposit(usdc.address, ethers.utils.parseUnits("1000", 6));
            }
            await omnivault.connect(signers[19]).redistribute([mooLp1.address, mooLp2.address, mooLp3.address], [33, 33, 33], [ethers.constants.AddressZero, ethers.constants.AddressZero, ethers.constants.AddressZero])
            await simulateIncreasedValueOfLP(mooLp1.address, ethers.utils.parseEther("10"), mooLp1.address);
            await simulateIncreasedValueOfLP(mooLp2.address, ethers.utils.parseEther("10"), mooLp2.address);
            await simulateIncreasedValueOfLP(mooLp3.address, ethers.utils.parseEther("10"), mooLp3.address);
            // Skip some time to force fee skimming
            await ethers.provider.send("evm_increaseTime", [700]);
            await omnivault.skimYieldFeeAndSendToAdmin();

            let allActiveUsers = await omnivault.getActiveUsers();
            let mooLp1BalanceBefore = await mooLp1.balanceOf(omnivault.address);
            let mooLp2BalanceBefore = await mooLp2.balanceOf(omnivault.address);
            let mooLp3BalanceBefore = await mooLp3.balanceOf(omnivault.address);

            let mooLpCounter1 = 0;
            let mooLpCounter2 = 0;
            let mooLpCounter3 = 0;
            for (let i = 0; i < allActiveUsers.length; i++) {
                let balanceArrays = await omnivault.balanceOf(allActiveUsers[i]);
                let balances = balanceArrays[1];
                let vaults = balanceArrays[0];
                for (let j = 0; j < balanceArrays[0].length; j++) {
                    if (vaults[j] == mooLp1.address && Number(balances[j]) > 0) {
                        mooLpCounter1 += Number(balances[j]);
                    }
                    if (vaults[j] == mooLp2.address && Number(balances[j]) > 0) {
                        mooLpCounter2 += Number(balances[j]);
                    }
                    if (vaults[j] == mooLp3.address && Number(balances[j]) > 0) {
                        mooLpCounter3 += Number(balances[j]);
                    }
                }

            }
            expect(Number(mooLpCounter1)).to.be.closeTo(Number(mooLp1BalanceBefore), tolerance);
            expect(Number(mooLpCounter2)).to.be.closeTo(Number(mooLp2BalanceBefore), tolerance);
            expect(Number(mooLpCounter3)).to.be.closeTo(Number(mooLp3BalanceBefore), tolerance);
        })

        it("Multiple redistribution cycles and skimming should ensure that the moo lps are distributed correctly", async function () {
            await omnivault.connect(signers[19]).setFeeOnYield(1000);
            for (let i = 0; i < 10; i++) {
                await usdc.connect(signers[i]).approve(omnivault.address, ethers.utils.parseUnits("1000", 6));
                await omnivault.connect(signers[i]).deposit(usdc.address, ethers.utils.parseUnits("1000", 6));
            }
            await omnivault.connect(signers[19]).redistribute([mooLp1.address, mooLp2.address, mooLp3.address], [33, 33, 33], [ethers.constants.AddressZero, ethers.constants.AddressZero, ethers.constants.AddressZero])
            await simulateIncreasedValueOfLP(mooLp1.address, ethers.utils.parseEther("10"), mooLp1.address);
            await simulateIncreasedValueOfLP(mooLp2.address, ethers.utils.parseEther("10"), mooLp2.address);
            await simulateIncreasedValueOfLP(mooLp3.address, ethers.utils.parseEther("10"), mooLp3.address);

            // Skip some time to force fee skimming
            await ethers.provider.send("evm_increaseTime", [700]);
            await omnivault.skimYieldFeeAndSendToAdmin();

            let allActiveUsers = await omnivault.getActiveUsers();
            let mooLp1BalanceBefore = await mooLp1.balanceOf(omnivault.address);
            let mooLp2BalanceBefore = await mooLp2.balanceOf(omnivault.address);
            let mooLp3BalanceBefore = await mooLp3.balanceOf(omnivault.address);

            let mooLpCounter1 = 0;
            let mooLpCounter2 = 0;
            let mooLpCounter3 = 0;

            for (let i = 0; i < allActiveUsers.length; i++) {
                let balanceArrays = await omnivault.balanceOf(allActiveUsers[i]);
                let balances = balanceArrays[1];
                let vaults = balanceArrays[0];
                for (let j = 0; j < balanceArrays[0].length; j++) {
                    if (vaults[j] == mooLp1.address && Number(balances[j]) > 0) {
                        mooLpCounter1 += Number(balances[j]);
                    }
                    if (vaults[j] == mooLp2.address && Number(balances[j]) > 0) {
                        mooLpCounter2 += Number(balances[j]);
                    }
                    if (vaults[j] == mooLp3.address && Number(balances[j]) > 0) {
                        mooLpCounter3 += Number(balances[j]);
                    }
                }

            }
            expect(Number(mooLpCounter1)).to.be.closeTo(Number(mooLp1BalanceBefore), tolerance);
            expect(Number(mooLpCounter2)).to.be.closeTo(Number(mooLp2BalanceBefore), tolerance);
            expect(Number(mooLpCounter3)).to.be.closeTo(Number(mooLp3BalanceBefore), tolerance);

            // Second redistribution cycle
            //
            //


            await simulateIncreasedValueOfLP(mooLp1.address, ethers.utils.parseEther("10"), mooLp1.address);
            await simulateIncreasedValueOfLP(mooLp2.address, ethers.utils.parseEther("10"), mooLp2.address);
            await simulateIncreasedValueOfLP(mooLp3.address, ethers.utils.parseEther("10"), mooLp3.address);
            // Fee gets skimmed already here
            await omnivault.connect(signers[19]).redistribute([mooLp1.address, mooLp2.address, mooLp3.address], [10, 50, 40], [ethers.constants.AddressZero, ethers.constants.AddressZero, ethers.constants.AddressZero])


            allActiveUsers = await omnivault.getActiveUsers();
            mooLp1BalanceBefore = await mooLp1.balanceOf(omnivault.address);
            mooLp2BalanceBefore = await mooLp2.balanceOf(omnivault.address);
            mooLp3BalanceBefore = await mooLp3.balanceOf(omnivault.address);

            mooLpCounter1 = 0;
            mooLpCounter2 = 0;
            mooLpCounter3 = 0;

            for (let i = 0; i < allActiveUsers.length; i++) {
                let balanceArrays = await omnivault.balanceOf(allActiveUsers[i]);
                let balances = balanceArrays[1];
                let vaults = balanceArrays[0];
                for (let j = 0; j < balanceArrays[0].length; j++) {
                    if (vaults[j] == mooLp1.address && Number(balances[j]) > 0) {
                        mooLpCounter1 += Number(balances[j]);
                    }
                    if (vaults[j] == mooLp2.address && Number(balances[j]) > 0) {
                        mooLpCounter2 += Number(balances[j]);
                    }
                    if (vaults[j] == mooLp3.address && Number(balances[j]) > 0) {
                        mooLpCounter3 += Number(balances[j]);
                    }
                }

            }
            expect(Number(mooLpCounter1)).to.be.closeTo(Number(mooLp1BalanceBefore), tolerance);
            expect(Number(mooLpCounter2)).to.be.closeTo(Number(mooLp2BalanceBefore), tolerance);
            expect(Number(mooLpCounter3)).to.be.closeTo(Number(mooLp3BalanceBefore), tolerance);
            // Third redistribution cycle

            await simulateIncreasedValueOfLP(mooLp1.address, ethers.utils.parseEther("10"), mooLp1.address);
            await simulateIncreasedValueOfLP(mooLp2.address, ethers.utils.parseEther("10"), mooLp2.address);
            await simulateIncreasedValueOfLP(mooLp3.address, ethers.utils.parseEther("10"), mooLp3.address);
            await omnivault.connect(signers[19]).redistribute([mooLp1.address, mooLp2.address, mooLp3.address], [30, 40, 30], [ethers.constants.AddressZero, ethers.constants.AddressZero, ethers.constants.AddressZero])


            allActiveUsers = await omnivault.getActiveUsers();
            mooLp1BalanceBefore = await mooLp1.balanceOf(omnivault.address);
            mooLp2BalanceBefore = await mooLp2.balanceOf(omnivault.address);
            mooLp3BalanceBefore = await mooLp3.balanceOf(omnivault.address);

            mooLpCounter1 = 0;
            mooLpCounter2 = 0;
            mooLpCounter3 = 0;
            for (let i = 0; i < allActiveUsers.length; i++) {
                let balanceArrays = await omnivault.balanceOf(allActiveUsers[i]);
                let balances = balanceArrays[1];
                let vaults = balanceArrays[0];
                for (let j = 0; j < balanceArrays[0].length; j++) {
                    if (vaults[j] == mooLp1.address && Number(balances[j]) > 0) {
                        mooLpCounter1 += Number(balances[j]);
                    }
                    if (vaults[j] == mooLp2.address && Number(balances[j]) > 0) {
                        mooLpCounter2 += Number(balances[j]);
                    }
                    if (vaults[j] == mooLp3.address && Number(balances[j]) > 0) {
                        mooLpCounter3 += Number(balances[j]);
                    }
                }

            }

            expect(Number(mooLpCounter1)).to.be.closeTo(Number(mooLp1BalanceBefore), tolerance);
            expect(Number(mooLpCounter2)).to.be.closeTo(Number(mooLp2BalanceBefore), tolerance);
            expect(Number(mooLpCounter3)).to.be.closeTo(Number(mooLp3BalanceBefore), tolerance);

        })

    })
    describe("Check gas efficiency of core functions", function () {
        it("Check respective gas price of skimYield: 1 depositor", async function () {
            await omnivault.connect(signers[19]).setFeeOnYield(1000);
            for (let i = 0; i < 1; i++) {
                await usdc.connect(signers[i]).approve(omnivault.address, ethers.utils.parseUnits("1000", 6));
                await omnivault.connect(signers[i]).deposit(usdc.address, ethers.utils.parseUnits("1000", 6));
            }
            await omnivault.connect(signers[19]).redistribute([mooLp1.address, mooLp2.address, mooLp3.address], [33, 33, 33], [ethers.constants.AddressZero, ethers.constants.AddressZero, ethers.constants.AddressZero])
            await simulateIncreasedValueOfLP(mooLp1.address, ethers.utils.parseEther("10"), mooLp1.address);
            await simulateIncreasedValueOfLP(mooLp2.address, ethers.utils.parseEther("10"), mooLp2.address);
            await simulateIncreasedValueOfLP(mooLp3.address, ethers.utils.parseEther("10"), mooLp3.address);
            // Skip some time to force fee skimming
            await ethers.provider.send("evm_increaseTime", [700]);
            console.log("Gas estimated for skimYield for 1 depositor:", await omnivault.estimateGas.skimYieldFeeAndSendToAdmin())
        })
        it("Check respective gas price of skimYield: 10 depositors", async function () {
            await omnivault.connect(signers[19]).setFeeOnYield(1000);
            for (let i = 0; i < 10; i++) {
                await usdc.connect(signers[i]).approve(omnivault.address, ethers.utils.parseUnits("1000", 6));
                await omnivault.connect(signers[i]).deposit(usdc.address, ethers.utils.parseUnits("1000", 6));
            }
            await omnivault.connect(signers[19]).redistribute([mooLp1.address, mooLp2.address, mooLp3.address], [33, 33, 33], [ethers.constants.AddressZero, ethers.constants.AddressZero, ethers.constants.AddressZero])
            await simulateIncreasedValueOfLP(mooLp1.address, ethers.utils.parseEther("10"), mooLp1.address);
            await simulateIncreasedValueOfLP(mooLp2.address, ethers.utils.parseEther("10"), mooLp2.address);
            await simulateIncreasedValueOfLP(mooLp3.address, ethers.utils.parseEther("10"), mooLp3.address);
            // Skip some time to force fee skimming
            await ethers.provider.send("evm_increaseTime", [700]);
            console.log("Gas estimated for skimYield for 10 depositors:", await omnivault.estimateGas.skimYieldFeeAndSendToAdmin())
        })
        // This is left in as a hypothetical test to see how gas inefficient the fee skimming is.
        // It is not run by default as it takes a long time to run.
        // This is the usual output
        // Gas estimated for skimYield for 100 depositors: BigNumber { value: "3666096" }
        // it.only("Check respective gas price of skimYield: 100 depositors", async function () {
        //     await omnivault.connect(signers[19]).setFeeOnYield(1000);

        //     for (let i = 0; i < 100; i++) {
        //         // Get a new wallet
        //         let wallet = ethers.Wallet.createRandom();
        //         // add the provider from Hardhat
        //         wallet = wallet.connect(ethers.provider);
        //         // send ETH to the new wallet so it can perform a tx
        //         await signers[10].sendTransaction({ to: wallet.address, value: ethers.utils.parseEther("0.1") });
        //         // Send it some usdc
        //         let usdWhale = await ethers.getImpersonatedSigner("0xebe80f029b1c02862b9e8a70a7e5317c06f62cae")
        //         // Send 1 eth to the whale
        //         await signers[0].sendTransaction({ to: usdWhale.address, value: ethers.utils.parseEther("1") })
        //         // Send some usdc
        //         await usdc.connect(usdWhale).transfer(wallet.address, ethers.utils.parseUnits("100", 6))
        //         await usdc.connect(wallet).approve(omnivault.address, ethers.utils.parseUnits("100", 6));
        //         await omnivault.connect(wallet).deposit(usdc.address, ethers.utils.parseUnits("100", 6));
        //         console.log("Done, wallet", i);

        //     }
        //     await omnivault.connect(signers[19]).redistribute([mooLp1.address, mooLp2.address, mooLp3.address], [33, 33, 33], [ethers.constants.AddressZero, ethers.constants.AddressZero, ethers.constants.AddressZero])
        //     await simulateIncreasedValueOfLP(mooLp1.address, ethers.utils.parseEther("10"), mooLp1.address);
        //     await simulateIncreasedValueOfLP(mooLp2.address, ethers.utils.parseEther("10"), mooLp2.address);
        //     await simulateIncreasedValueOfLP(mooLp3.address, ethers.utils.parseEther("10"), mooLp3.address);
        //     // Skip some time to force fee skimming
        //     await ethers.provider.send("evm_increaseTime", [700]);
        //     console.log("Gas estimated for skimYield for 100 depositors:", await omnivault.estimateGas.skimYieldFeeAndSendToAdmin())

        // })
    })
    describe("Admin functions", function () {
        it("Should update the primary token correctly", async function () {
            await omnivault.connect(signers[19]).setPrimaryToken(weth.address);
            expect(await omnivault.primaryToken()).to.be.equal(weth.address);
        });

        it("Should update the fee correctly", async function () {
            await omnivault.connect(signers[19]).setFeeOnYield(1000);
            expect(await omnivault.feeOnYield()).to.be.equal(1000);
        })
        it("Should set the exchangeAddress correctly", async function () {
            await omnivault.connect(signers[19]).setExchangeAddress(exchange.address);
            expect(await omnivault.exchangeAddress()).to.be.equal(exchange.address);
        })

        it("Should set skimYieldPeriod correctly", async function () {
            await omnivault.connect(signers[19]).setSkimYieldPeriod(100);
            expect(await omnivault.skimYieldPeriod()).to.be.equal(100);
        })
        it("Should set boost vault correctly", async function () {
            await omnivault.connect(signers[19]).setBoostVault(mooLp1.address, mooLp2.address);
            expect(await omnivault.vaultToBoost(mooLp1.address)).to.be.equal(mooLp2.address);
        })

        it("Should set min reward token for swap correctly", async function () {
            await omnivault.connect(signers[19]).setRewardTokenToMinSwapAmount(mooLp1.address, ethers.utils.parseUnits("100", 6));
            expect(await omnivault.rewardTokenToMinSwapAmount(mooLp1.address)).to.be.equal(ethers.utils.parseUnits("100", 6));
        })
        it("Should claim fees correctly", async function () {
            await omnivault.connect(signers[19]).setFeeOnYield(1000);

            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("1000", 6));
            await omnivault.connect(signers[0]).deposit(usdc.address, ethers.utils.parseUnits("1000", 6));
            await simulateIncreasedValueOfLP(mooLp1.address, ethers.utils.parseEther("10"), mooLp1.address);
            let adminUSDCBalanceBefore = await usdc.balanceOf(admin.address);
            // Skip some time to force fee skimming
            await ethers.provider.send("evm_increaseTime", [700]);
            await omnivault.connect(signers[0]).withdraw(usdc.address, 100)
            await omnivault.connect(signers[19]).claimAdminFees()
            expect(Number(await usdc.balanceOf(admin.address))).to.be.greaterThan(Number(adminUSDCBalanceBefore));
        })

        it("Claiming fees when it is zero should revert", async function () {
            await expect(omnivault.connect(signers[19]).claimAdminFees()).to.be.revertedWith("NO_FEES")
        })

    })

    describe("View functions", function () {
        it("Get active vaults", async function () {
            let activeVaults = await omnivault.getActiveUnderlyingVaults();
            expect(activeVaults.length).to.be.equal(1);
            expect(activeVaults[0]).to.be.equal(mooLp1.address);
        })

        it("Get active vault percentages", async function () {
            let percentages = await omnivault.getUnderlyingVaultsPercents();
            expect(percentages.length).to.be.equal(1);
            expect(percentages[0]).to.be.equal(100);
        })

        it("Get active users (with no depositors should return length 0)", async function () {
            let users = await omnivault.getActiveUsers();
            expect(users.length).to.be.equal(0);
        })
        it("Get active users (with 5 depositors should return length 5)", async function () {
            for (let i = 0; i < 5; i++) {
                await usdc.connect(signers[i]).approve(omnivault.address, ethers.utils.parseUnits("1000", 6));
                await omnivault.connect(signers[i]).deposit(usdc.address, ethers.utils.parseUnits("1000", 6));
            }
            let users = await omnivault.getActiveUsers();
            expect(users.length).to.be.equal(5);
        })

        it("Get active users should return 4 if there were 5 depositors and one withdrew 100%", async function () {
            for (let i = 0; i < 5; i++) {
                await usdc.connect(signers[i]).approve(omnivault.address, ethers.utils.parseUnits("1000", 6));
                await omnivault.connect(signers[i]).deposit(usdc.address, ethers.utils.parseUnits("1000", 6));
            }
            await omnivault.connect(signers[0]).withdraw(usdc.address, 100)
            let users = await omnivault.getActiveUsers();

            expect(users.length).to.be.equal(4);
        })

        it("Get active users should return 5 if there were 5 depositors and one withdrew 50%", async function () {
            for (let i = 0; i < 5; i++) {
                await usdc.connect(signers[i]).approve(omnivault.address, ethers.utils.parseUnits("1000", 6));
                await omnivault.connect(signers[i]).deposit(usdc.address, ethers.utils.parseUnits("1000", 6));
            }
            await omnivault.connect(signers[0]).withdraw(usdc.address, 50)
            let users = await omnivault.getActiveUsers();

            expect(users.length).to.be.equal(5);
        })

        it("BalanceOf for a user who has deposited should return all non zero numbers", async function () {
            await usdc.connect(signers[0]).approve(omnivault.address, ethers.utils.parseUnits("1000", 6));
            await omnivault.connect(signers[0]).deposit(usdc.address, ethers.utils.parseUnits("1000", 6));
            let balance = await omnivault.balanceOf(signers[0].address);
            let vaults = balance[0];
            let balances = balance[1];
            expect(balances.length).to.be.equal(1);
            expect(vaults.length).to.be.equal(1);
            expect(Number(balances[0])).to.be.greaterThan(0);
        })
        it("BalanceOf for a user who has not deposited should return 0 for all vaults", async function () {
            let balance = await omnivault.balanceOf(signers[0].address);
            let vaults = balance[0];
            let balances = balance[1];
            expect(balances.length).to.be.equal(1);
            expect(vaults.length).to.be.equal(1);
            expect(Number(balances[0])).to.be.equal(0);
        })
    })

    async function simulateIncreasedValueOfLP(vault: string, amount: BigNumber, recipient: string) {
        // Unfortunately we have not added all the underlying LPs, therefore we will use this round abotu method to get the underlying LP.
        let beefyVault = await ethers.getContractAt("IBeefyVault", vault);
        await exchange.connect(signers[5]).exchange(ethers.constants.AddressZero, vault, amount, 0, { value: amount });
        await beefyVault.connect(signers[5]).withdrawAll()
        let want = await beefyVault.want();
        let wantToken = await ethers.getContractAt("IERC20", want);
        await wantToken.connect(signers[5]).transfer(recipient, await wantToken.balanceOf(signers[5].address));
    }
})