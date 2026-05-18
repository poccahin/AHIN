//! AHIN Trusted Twin Court readiness trust kernel.
//!
//! This crate is archived for local/offline verification readiness only. It does
//! not sign payloads, submit transactions, mutate multisig state, or claim
//! WebAuthn/FIDO2 or biometric verification.

#![cfg_attr(not(feature = "std"), no_std)]
#![forbid(unsafe_code)]

extern crate alloc;

use alloc::string::{String, ToString};
use alloc::vec::Vec;

use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use thiserror::Error;

/// Canonical AHIN Foundation treasury multisig address.
pub const CANONICAL_TREASURY_MULTISIG: &str = "5Cohfz6H7vHzQpp7fEdUgtrpqzG2ff2VvZTrrCUgCzRo";

/// The R0-G2 readiness envelope must not claim on-chain submission.
pub const ON_CHAIN_SUBMITTED: bool = false;

/// The trust kernel archive does not enable protocol execution.
pub const PROTOCOL_EXECUTION_ENABLED: bool = false;

/// The trust kernel archive does not enable signing.
pub const SIGNING_ENABLED: bool = false;

/// A 32-byte SHA-256 digest.
pub type Hash = [u8; 32];

/// Trust-kernel errors.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum KernelError {
    /// The leaf set was empty or an index was invalid.
    #[error("Malformed readiness proof: {0}")]
    Malformed(String),

    /// The reconstructed Merkle root did not match the claimed root.
    #[error("Merkle proof mismatch")]
    MerkleMismatch,

    /// The public key or signature was malformed.
    #[error("Invalid Ed25519 material: {0}")]
    InvalidSignatureMaterial(String),

    /// The signature did not verify.
    #[error("Ed25519 verification failed")]
    SignatureInvalid,

    /// The envelope claims a live action that is not allowed in readiness mode.
    #[error("Readiness envelope contains forbidden live authority")]
    ForbiddenLiveAuthority,
}

/// Compute a SHA-256 digest.
pub fn sha256(data: &[u8]) -> Hash {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

/// Hash a leaf payload with domain separation.
pub fn leaf_hash(payload: &[u8]) -> Hash {
    let mut hasher = Sha256::new();
    hasher.update([0x00]);
    hasher.update(payload);
    hasher.finalize().into()
}

/// Hash two internal children with domain separation.
pub fn inner_hash(left: &Hash, right: &Hash) -> Hash {
    let mut hasher = Sha256::new();
    hasher.update([0x01]);
    hasher.update(left);
    hasher.update(right);
    hasher.finalize().into()
}

/// Build a Merkle root from leaf payloads.
pub fn merkle_root_from_payloads(payloads: &[&[u8]]) -> Result<Hash, KernelError> {
    if payloads.is_empty() {
        return Err(KernelError::Malformed("empty payload set".to_string()));
    }

    let mut layer: Vec<Hash> = payloads.iter().map(|payload| leaf_hash(payload)).collect();
    while layer.len() > 1 {
        let mut next = Vec::with_capacity((layer.len() + 1) / 2);
        for pair in layer.chunks(2) {
            let left = pair[0];
            let right = if pair.len() == 2 { pair[1] } else { pair[0] };
            next.push(inner_hash(&left, &right));
        }
        layer = next;
    }

    Ok(layer[0])
}

/// A Merkle proof replay step.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProofStep {
    /// Sibling hash encoded as lowercase hex.
    pub sibling_hex: String,
    /// True when the sibling is on the right side of the current node.
    pub sibling_is_right: bool,
}

/// A compact inclusion proof.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct MerkleProof {
    /// Leaf hash encoded as lowercase hex.
    pub leaf_hex: String,
    /// Sibling steps from leaf to root.
    pub siblings: Vec<ProofStep>,
    /// Expected root encoded as lowercase hex.
    pub root_hex: String,
}

/// Decode a 32-byte hex hash.
pub fn decode_hash(value: &str) -> Result<Hash, KernelError> {
    let decoded = hex::decode(value).map_err(|error| KernelError::Malformed(error.to_string()))?;
    decoded
        .try_into()
        .map_err(|_| KernelError::Malformed("hash must be 32 bytes".to_string()))
}

/// Verify a Merkle inclusion proof.
pub fn verify_merkle_proof(proof: &MerkleProof) -> Result<(), KernelError> {
    let mut current = decode_hash(&proof.leaf_hex)?;
    let expected = decode_hash(&proof.root_hex)?;

    for step in &proof.siblings {
        let sibling = decode_hash(&step.sibling_hex)?;
        current = if step.sibling_is_right {
            inner_hash(&current, &sibling)
        } else {
            inner_hash(&sibling, &current)
        };
    }

    if current == expected {
        Ok(())
    } else {
        Err(KernelError::MerkleMismatch)
    }
}

/// Verify an Ed25519 signature.
pub fn verify_ed25519(public_key_hex: &str, payload: &[u8], signature_hex: &str) -> Result<(), KernelError> {
    let public_key_bytes = hex::decode(public_key_hex).map_err(|error| KernelError::InvalidSignatureMaterial(error.to_string()))?;
    let signature_bytes = hex::decode(signature_hex).map_err(|error| KernelError::InvalidSignatureMaterial(error.to_string()))?;
    let public_key_array: [u8; 32] = public_key_bytes
        .try_into()
        .map_err(|_| KernelError::InvalidSignatureMaterial("public key must be 32 bytes".to_string()))?;
    let signature_array: [u8; 64] = signature_bytes
        .try_into()
        .map_err(|_| KernelError::InvalidSignatureMaterial("signature must be 64 bytes".to_string()))?;

    let public_key = VerifyingKey::from_bytes(&public_key_array).map_err(|error| KernelError::InvalidSignatureMaterial(error.to_string()))?;
    let signature = Signature::from_bytes(&signature_array);
    public_key.verify(payload, &signature).map_err(|_| KernelError::SignatureInvalid)
}

/// Readiness certificate flags.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct ReadinessCertificate {
    /// Case identifier.
    pub case_id: String,
    /// Candidate evidence hash. This is not a chain-submission claim.
    pub candidate_evidence_hash: String,
    /// Canonical treasury multisig address.
    pub treasury_multisig: String,
    /// Whether the certificate has been submitted on-chain.
    pub on_chain_submitted: bool,
    /// Whether protocol execution is enabled.
    pub protocol_execution_enabled: bool,
    /// Whether signing is enabled.
    pub signing_enabled: bool,
}

/// Validate that a certificate remains in readiness mode.
pub fn validate_readiness_certificate(certificate: &ReadinessCertificate) -> Result<(), KernelError> {
    if certificate.treasury_multisig != CANONICAL_TREASURY_MULTISIG {
        return Err(KernelError::Malformed("unexpected treasury multisig".to_string()));
    }
    if certificate.on_chain_submitted || certificate.protocol_execution_enabled || certificate.signing_enabled {
        return Err(KernelError::ForbiddenLiveAuthority);
    }
    Ok(())
}

