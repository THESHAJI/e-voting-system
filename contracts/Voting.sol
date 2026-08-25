// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title EVoting V3.1
 * @notice Commit–Reveal voting with identity binding, generation-based reset,
 *         emergency pause, and dual election type support (National / College).
 */
contract EVoting {

    // ────────────────────── Types ──────────────────────
    enum Phase { SETUP, COMMIT, REVEAL, ENDED }
    enum ElectionType { NATIONAL, COLLEGE }

    // ────────────────────── State ──────────────────────
    address public admin;
    Phase   public currentPhase;
    ElectionType public electionType;
    bool    public paused;
    uint256 public generationId;          // incremented on each reset

    struct Candidate {
        string  name;
        string  logoHash;                 // IPFS hash or filename
        uint256 voteCount;
    }

    Candidate[] public candidates;

    // All voter mappings scoped by (generationId, address)
    mapping(uint256 => mapping(address => bool))    public verifiedVoters;
    mapping(uint256 => mapping(address => bool))    public hasCommitted;
    mapping(uint256 => mapping(address => bool))    public hasRevealed;
    mapping(uint256 => mapping(address => bytes32)) private voteCommitments;

    // Identity binding:  SHA-256(aadhaar/regNo) => wallet   (permanent across resets)
    mapping(bytes32 => address) public identityToWallet;
    mapping(address => bytes32) public walletToIdentity;

    // ────────────────────── Events ──────────────────────
    event PhaseChanged(Phase newPhase, uint256 generationId);
    event CandidateAdded(uint256 index, string name, uint256 generationId);
    event VoterVerified(address voter, uint256 generationId);
    event IdentityBound(bytes32 identityHash, address wallet);
    event VoteCommitted(address voter, bytes32 commitment, uint256 generationId);
    event VoteRevealed(address voter, uint256 candidateIndex, uint256 generationId);
    event SystemPaused(bool isPaused);
    event ElectionReset(uint256 newGenerationId);

    // ────────────────────── Modifiers ──────────────────────
    modifier onlyAdmin() {
        require(msg.sender == admin, "Not admin");
        _;
    }

    modifier notPaused() {
        require(!paused, "System is paused");
        _;
    }

    modifier onlyVerified() {
        require(verifiedVoters[generationId][msg.sender], "Not verified voter");
        _;
    }

    modifier inPhase(Phase _phase) {
        require(currentPhase == _phase, "Wrong phase");
        _;
    }

    // ────────────────────── Constructor ──────────────────────
    constructor() {
        admin = msg.sender;
        currentPhase = Phase.SETUP;
        generationId = 1;
        electionType = ElectionType.NATIONAL;
    }

    // ══════════════════════ ADMIN FUNCTIONS ══════════════════════

    function setElectionType(ElectionType _type) external onlyAdmin inPhase(Phase.SETUP) {
        electionType = _type;
    }

    function addCandidate(string memory _name, string memory _logoHash)
        external onlyAdmin inPhase(Phase.SETUP)
    {
        candidates.push(Candidate(_name, _logoHash, 0));
        emit CandidateAdded(candidates.length - 1, _name, generationId);
    }

    function verifyVoter(address _voter) external onlyAdmin notPaused {
        verifiedVoters[generationId][_voter] = true;
        emit VoterVerified(_voter, generationId);
    }

    function batchVerifyVoters(address[] memory _voters) external onlyAdmin notPaused {
        for (uint256 i = 0; i < _voters.length; i++) {
            verifiedVoters[generationId][_voters[i]] = true;
            emit VoterVerified(_voters[i], generationId);
        }
    }

    // ── Phase Transitions ──

    function startVoting() external onlyAdmin inPhase(Phase.SETUP) notPaused {
        require(candidates.length > 0, "Add candidates first");
        currentPhase = Phase.COMMIT;
        emit PhaseChanged(Phase.COMMIT, generationId);
    }

    function startReveal() external onlyAdmin inPhase(Phase.COMMIT) notPaused {
        currentPhase = Phase.REVEAL;
        emit PhaseChanged(Phase.REVEAL, generationId);
    }

    function endElection() external onlyAdmin inPhase(Phase.REVEAL) notPaused {
        currentPhase = Phase.ENDED;
        emit PhaseChanged(Phase.ENDED, generationId);
    }

    // ── Emergency ──

    function pauseSystem() external onlyAdmin {
        paused = true;
        emit SystemPaused(true);
    }

    function unpauseSystem() external onlyAdmin {
        paused = false;
        emit SystemPaused(false);
    }

    // ── Atomic Reset (Fresh Start) ──

    function resetElection() external onlyAdmin {
        generationId++;
        currentPhase = Phase.SETUP;
        paused = false;
        delete candidates;
        emit ElectionReset(generationId);
        emit PhaseChanged(Phase.SETUP, generationId);
    }

    // ══════════════════════ IDENTITY BINDING ══════════════════════

    /**
     * @notice Bind a SHA-256 identity hash to a wallet.
     *         Called by backend after Aadhaar / Student verification.
     *         Enforces: 1 identity → 1 wallet; 1 wallet → 1 identity.
     */
    function bindIdentity(bytes32 _identityHash, address _wallet)
        external onlyAdmin notPaused
    {
        require(identityToWallet[_identityHash] == address(0), "Identity already bound");
        require(walletToIdentity[_wallet] == bytes32(0), "Wallet already bound");

        identityToWallet[_identityHash] = _wallet;
        walletToIdentity[_wallet] = _identityHash;
        emit IdentityBound(_identityHash, _wallet);
    }

    // ══════════════════════ VOTER FUNCTIONS ══════════════════════

    function commitVote(bytes32 _commitment)
        external onlyVerified inPhase(Phase.COMMIT) notPaused
    {
        require(!hasCommitted[generationId][msg.sender], "Already committed");

        voteCommitments[generationId][msg.sender] = _commitment;
        hasCommitted[generationId][msg.sender] = true;
        emit VoteCommitted(msg.sender, _commitment, generationId);
    }

    function revealVote(uint256 _candidateIndex, string memory _secret)
        external onlyVerified inPhase(Phase.REVEAL) notPaused
    {
        require(hasCommitted[generationId][msg.sender], "No commit found");
        require(!hasRevealed[generationId][msg.sender], "Already revealed");
        require(_candidateIndex < candidates.length, "Invalid candidate");

        bytes32 computedHash = keccak256(abi.encodePacked(_candidateIndex, _secret));
        require(computedHash == voteCommitments[generationId][msg.sender], "Invalid reveal");

        candidates[_candidateIndex].voteCount++;
        hasRevealed[generationId][msg.sender] = true;
        emit VoteRevealed(msg.sender, _candidateIndex, generationId);
    }

    // ══════════════════════ VIEW FUNCTIONS ══════════════════════

    function getVoteCount(uint256 _index) external view returns (uint256) {
        return candidates[_index].voteCount;
    }

    function getTotalCandidates() external view returns (uint256) {
        return candidates.length;
    }

    function getCandidate(uint256 _index)
        external view returns (string memory name, string memory logoHash, uint256 voteCount)
    {
        Candidate memory c = candidates[_index];
        return (c.name, c.logoHash, c.voteCount);
    }

    function getPhase() external view returns (Phase) {
        return currentPhase;
    }

    function getElectionInfo()
        external view
        returns (Phase phase, ElectionType eType, bool isPaused, uint256 genId, uint256 candidateCount)
    {
        return (currentPhase, electionType, paused, generationId, candidates.length);
    }

    function isVoterVerified(address _voter) external view returns (bool) {
        return verifiedVoters[generationId][_voter];
    }

    function hasVoterCommitted(address _voter) external view returns (bool) {
        return hasCommitted[generationId][_voter];
    }

    function hasVoterRevealed(address _voter) external view returns (bool) {
        return hasRevealed[generationId][_voter];
    }
}
