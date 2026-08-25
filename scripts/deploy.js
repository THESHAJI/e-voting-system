const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  console.log("\n🔨 Compiling EVoting V3.1...");
  const Voting = await hre.ethers.getContractFactory("EVoting");
  const voting = await Voting.deploy();
  await voting.waitForDeployment();

  const address = await voting.getAddress();
  console.log(`\n✅ EVoting V3.1 deployed to: ${address}`);

  // Write config.json for frontend auto-discovery
  const config = {
    contractAddress: address,
    network: "localhost",
    chainId: 31337,
    deployedAt: new Date().toISOString(),
    version: "3.1"
  };

  const configPath = path.join(__dirname, "../frontend/config.json");
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
  console.log(`📋 Config written to: ${configPath}`);

  // Write ABI for frontend
  const artifact = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../artifacts/contracts/Voting.sol/EVoting.json"),
      "utf8"
    )
  );

  const abiPath = path.join(__dirname, "../frontend/abi.json");
  fs.writeFileSync(abiPath, JSON.stringify(artifact.abi, null, 2));
  console.log(`📋 ABI written to: ${abiPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
