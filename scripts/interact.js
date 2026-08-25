const hre = require("hardhat");

async function main() {
  const address = "0x851356ae760d987E095750cCeb3bC6014560891C";

  const EVoting = await hre.ethers.getContractFactory("EVoting");
  const voting = await EVoting.attach(address);

  const [admin, voter] = await hre.ethers.getSigners();

  await voting.addCandidate("Party A");
  await voting.addCandidate("Party B");

  await voting.verifyVoter(voter.address);

  await voting.startVoting();

  // Commit vote
  const secret = "mySecret123";
  const hash = hre.ethers.solidityPackedKeccak256(
  ["uint256", "string"],
  [0, secret]
);

  await voting.connect(voter).commitVote(hash);

  await voting.endVoting();

  // Reveal vote
  await voting.connect(voter).revealVote(0, secret);

  const result = await voting.getCandidate(0);
  console.log("Party A votes:", result[1].toString());
}

main().catch(console.error);
