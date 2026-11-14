//! Sealed Diligence escrow.
//!
//! An investor escrows a fee and pins the founder's account, the commit, the question-pack hash, the
//! model, and the NEAR AI enclave signing key they verified off-chain (TDX + GPU attestation).
//! The fee is released to the founder only when a seal is submitted that:
//!
//! 1. was signed by that enclave key (ed25519 over NEAR AI's `provider_tee` payload
//!    `"<model>:<sha256(request)>:<sha256(response)>"`), and
//! 2. whose request body names this request id, commit and question pack.
//!
//! Otherwise the investor can reclaim the fee after the deadline.
use near_sdk::store::LookupMap;
use near_sdk::{env, near, require, AccountId, NearToken, PanicOnDefault, Promise};

/// A git commit SHA-1 in bytes (40 hex characters).
const COMMIT_BYTES: usize = 20;
/// A SHA-256 digest in bytes (64 hex characters).
const SHA256_BYTES: usize = 32;
/// An ed25519 public key in bytes.
const ED25519_KEY_BYTES: usize = 32;
/// An ed25519 signature in bytes.
const ED25519_SIGNATURE_BYTES: usize = 64;
const NANOSECONDS_PER_HOUR: u64 = 3_600_000_000_000;
const MIN_TIMEOUT_HOURS: u64 = 1;
const MAX_TIMEOUT_HOURS: u64 = 24 * 90;
/// The seal input follows this index in the request's `messages` (after the system prompt).
const USER_MESSAGE: usize = 1;

/// Where a request is in its life.
#[near(serializers = [borsh, json])]
#[derive(Clone, PartialEq, Debug)]
pub enum Status {
    /// Waiting for a valid seal.
    Open,
    /// A valid seal arrived and the fee went to the founder.
    Fulfilled,
    /// The deadline passed and the fee went back to the investor.
    Refunded,
}

/// One diligence request and everything it pins.
#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Request {
    pub id: u64,
    /// `"<contract account>#<id>"`: the id the review must name in its seal.
    pub request_id: String,
    pub investor: AccountId,
    pub founder: AccountId,
    /// Lowercase 40-hex git commit.
    pub commit: String,
    /// Lowercase hex SHA-256 of the question pack.
    pub pack_hash: String,
    pub model: String,
    /// Lowercase hex ed25519 public key of the attested enclave.
    pub enclave_key: String,
    pub fee: NearToken,
    /// Block timestamp after which only a refund is possible.
    pub deadline_ns: u64,
    pub status: Status,
    /// The signed seal text once fulfilled: `"<model>:<request hash>:<response hash>"`.
    pub seal_text: Option<String>,
}

/// The escrow contract's state.
#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Escrow {
    requests: LookupMap<u64, Request>,
    next_id: u64,
}

/// True when `s` is exactly `bytes` bytes of hex.
fn is_hex(s: &str, bytes: usize) -> bool {
    s.len() == bytes * 2 && s.chars().all(|c| c.is_ascii_hexdigit())
}

/// The three fields of NEAR AI's signed text, split from the right because the model name may contain `:`.
struct SignedText<'a> {
    model: &'a str,
    request_hash: &'a str,
    response_hash: &'a str,
}

impl<'a> SignedText<'a> {
    fn parse(text: &'a str) -> Self {
        let parts: Vec<&str> = text.rsplitn(3, ':').collect();
        require!(parts.len() == 3, "malformed seal text");
        Self {
            model: parts[2],
            request_hash: parts[1],
            response_hash: parts[0],
        }
    }
}

/// Step 1: the signed text names the pinned model and hashes exactly the submitted request body.
fn require_text_matches_body(req: &Request, seal_text: &str, seal_request_body: &str) {
    let text = SignedText::parse(seal_text);
    let request_hash = hex::encode(env::sha256(seal_request_body.as_bytes()));
    require!(
        text.model == req.model,
        "seal was produced by a different model"
    );
    require!(
        text.request_hash == request_hash,
        "seal text does not match the submitted request body"
    );
    require!(
        is_hex(text.response_hash, SHA256_BYTES),
        "malformed response hash"
    );
}

/// Step 2: the pinned enclave key signed the text.
fn require_enclave_signature(req: &Request, seal_text: &str, signature_hex: &str) {
    let signature: [u8; ED25519_SIGNATURE_BYTES] = hex::decode(signature_hex)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .expect("signature must be 64 bytes hex");
    // `create_request` only stores keys that pass `is_hex(.., ED25519_KEY_BYTES)`.
    let key: [u8; ED25519_KEY_BYTES] = hex::decode(&req.enclave_key)
        .ok()
        .and_then(|bytes| bytes.try_into().ok())
        .expect("stored enclave key is valid hex");
    require!(
        env::ed25519_verify(&signature, seal_text.as_bytes(), &key),
        "signature is not from the pinned enclave key"
    );
}

/// Step 3: the sealed review is about this request, commit and question pack.
fn require_seal_input_matches(req: &Request, seal_request_body: &str) {
    let body: serde_json::Value =
        serde_json::from_str(seal_request_body).expect("request body is not JSON");
    require!(
        body["model"].as_str() == Some(req.model.as_str()),
        "request body names a different model"
    );
    let user = body["messages"][USER_MESSAGE]["content"]
        .as_str()
        .expect("missing seal input");
    let input: serde_json::Value =
        serde_json::from_str(&user[user.find('{').expect("missing seal input")..])
            .expect("seal input is not JSON");
    require!(
        input["request_id"].as_str() == Some(req.request_id.as_str()),
        "seal is for a different request"
    );
    require!(
        input["commit"].as_str() == Some(req.commit.as_str()),
        "seal is for a different commit"
    );
    require!(
        input["pack_hash"].as_str() == Some(req.pack_hash.as_str()),
        "seal used a different question pack"
    );
}

#[near]
impl Escrow {
    /// Deploy with no requests.
    #[init]
    pub fn new() -> Self {
        Self {
            requests: LookupMap::new(b"r"),
            next_id: 0,
        }
    }

    /// Investor posts a diligence request; the attached deposit is the fee.
    ///
    /// `enclave_key` is the signing key the investor verified with `sealed-diligence verify` (or the
    /// browser verifier); only seals signed by it will release the fee.
    #[payable]
    pub fn create_request(
        &mut self,
        founder: AccountId,
        commit: String,
        pack_hash: String,
        model: String,
        enclave_key: String,
        timeout_hours: u64,
    ) -> Request {
        let fee = env::attached_deposit();
        require!(fee > NearToken::from_yoctonear(0), "attach the fee");
        require!(
            is_hex(&commit, COMMIT_BYTES),
            "commit must be a 40-hex git sha"
        );
        require!(
            is_hex(&pack_hash, SHA256_BYTES),
            "pack_hash must be 32 bytes hex"
        );
        require!(
            is_hex(&enclave_key, ED25519_KEY_BYTES),
            "enclave_key must be an ed25519 public key (32 bytes hex)"
        );
        require!(
            (MIN_TIMEOUT_HOURS..=MAX_TIMEOUT_HOURS).contains(&timeout_hours),
            "timeout between 1 hour and 90 days"
        );
        let id = self.next_id;
        self.next_id += 1;
        let req = Request {
            id,
            request_id: format!("{}#{}", env::current_account_id(), id),
            investor: env::predecessor_account_id(),
            founder,
            commit: commit.to_lowercase(),
            pack_hash: pack_hash.to_lowercase(),
            model,
            enclave_key: enclave_key.to_lowercase(),
            fee,
            deadline_ns: env::block_timestamp() + timeout_hours * NANOSECONDS_PER_HOUR,
            status: Status::Open,
            seal_text: None,
        };
        self.requests.insert(id, req.clone());
        env::log_str(&format!(
            "EVENT_JSON:{{\"event\":\"request_created\",\"id\":{},\"request_id\":\"{}\"}}",
            id, req.request_id
        ));
        req
    }

    /// Submit the seal and pay the founder. Anyone may call it: the fee always goes to the founder.
    ///
    /// `seal_request_body` is the exact request JSON sent to NEAR AI for the seal call (it contains hashes
    /// and findings only, never source); `seal_text` and `signature_hex` are NEAR AI's signature record.
    /// The CLI's `fulfil-args` command prepares all three from a receipt.
    pub fn fulfil(
        &mut self,
        id: u64,
        seal_request_body: String,
        seal_text: String,
        signature_hex: String,
    ) -> Promise {
        let mut req = self.requests.get(&id).cloned().expect("no such request");
        require!(req.status == Status::Open, "request is not open");
        require!(env::block_timestamp() <= req.deadline_ns, "request expired");

        require_text_matches_body(&req, &seal_text, &seal_request_body);
        require_enclave_signature(&req, &seal_text, &signature_hex);
        require_seal_input_matches(&req, &seal_request_body);

        req.status = Status::Fulfilled;
        req.seal_text = Some(seal_text);
        let (founder, fee) = (req.founder.clone(), req.fee);
        env::log_str(&format!(
            "EVENT_JSON:{{\"event\":\"request_fulfilled\",\"id\":{}}}",
            id
        ));
        self.requests.insert(id, req);
        Promise::new(founder).transfer(fee)
    }

    /// Investor reclaims the fee if no valid seal arrived before the deadline.
    pub fn refund(&mut self, id: u64) -> Promise {
        let mut req = self.requests.get(&id).cloned().expect("no such request");
        require!(req.status == Status::Open, "request is not open");
        require!(
            env::block_timestamp() > req.deadline_ns,
            "deadline has not passed"
        );
        req.status = Status::Refunded;
        let (investor, fee) = (req.investor.clone(), req.fee);
        self.requests.insert(id, req);
        Promise::new(investor).transfer(fee)
    }

    /// One request, if it exists. The verifiers read this to confirm a receipt was paid for.
    pub fn get_request(&self, id: u64) -> Option<Request> {
        self.requests.get(&id).cloned()
    }

    /// The id the next request will get.
    pub fn next_id(&self) -> u64 {
        self.next_id
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};
    use near_sdk::test_utils::{accounts, VMContextBuilder};
    use near_sdk::testing_env;

    const MODEL: &str = "deepseek-ai/DeepSeek-V4.1-Flash-1017";
    const COMMIT: &str = "0123456789abcdef0123456789abcdef01234567";
    const PACK: &str = "aa00000000000000000000000000000000000000000000000000000000000000";
    const ONE_NEAR: u128 = 10u128.pow(24);

    fn ctx(pred: usize, deposit: u128, ts: u64) {
        testing_env!(VMContextBuilder::new()
            .current_account_id("escrow.testnet".parse().unwrap())
            .predecessor_account_id(accounts(pred))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(ts)
            .build());
    }

    /// A seal request body, its signed text and the signature, as NEAR AI would produce them.
    fn seal(key: &SigningKey, request_id: &str, commit: &str) -> (String, String, String) {
        let input = format!(
            "{{\"protocol\":\"sealed-diligence/v1\",\"request_id\":\"{}\",\"commit\":\"{}\",\"pack_hash\":\"{}\",\"files\":[]}}",
            request_id, commit, PACK
        );
        let body = serde_json::json!({"model": MODEL, "messages": [
            {"role": "system", "content": "x"}, {"role": "user", "content": format!("DILIGENCE INPUT:\n{}", input)}]})
        .to_string();
        let text = format!(
            "{}:{}:{}",
            MODEL,
            hex::encode(env::sha256(body.as_bytes())),
            "bb".repeat(32)
        );
        let sig = hex::encode(key.sign(text.as_bytes()).to_bytes());
        (body, text, sig)
    }

    fn setup() -> (Escrow, SigningKey, Request) {
        let key = SigningKey::generate(&mut rand::rngs::OsRng);
        ctx(0, ONE_NEAR, 0);
        let mut c = Escrow::new();
        let r = c.create_request(
            accounts(1),
            COMMIT.into(),
            PACK.into(),
            MODEL.into(),
            hex::encode(key.verifying_key().to_bytes()),
            24,
        );
        (c, key, r)
    }

    #[test]
    fn pays_on_valid_seal() {
        let (mut c, key, r) = setup();
        let (body, text, sig) = seal(&key, &r.request_id, COMMIT);
        ctx(2, 0, 1);
        let _ = c.fulfil(r.id, body, text, sig);
        assert_eq!(c.get_request(r.id).unwrap().status, Status::Fulfilled);
    }

    #[test]
    #[should_panic(expected = "signature is not from the pinned enclave key")]
    fn rejects_other_key() {
        let (mut c, _key, r) = setup();
        let other = SigningKey::generate(&mut rand::rngs::OsRng);
        let (body, text, sig) = seal(&other, &r.request_id, COMMIT);
        let _ = c.fulfil(r.id, body, text, sig);
    }

    #[test]
    #[should_panic(expected = "seal is for a different commit")]
    fn rejects_other_commit() {
        let (mut c, key, r) = setup();
        let (body, text, sig) = seal(
            &key,
            &r.request_id,
            "ffffffffffffffffffffffffffffffffffffffff",
        );
        let _ = c.fulfil(r.id, body, text, sig);
    }

    #[test]
    #[should_panic(expected = "seal text does not match the submitted request body")]
    fn rejects_swapped_body() {
        let (mut c, key, r) = setup();
        let (_body, text, sig) = seal(&key, &r.request_id, COMMIT);
        let (other_body, _, _) = seal(&key, "escrow.testnet#99", COMMIT);
        let _ = c.fulfil(r.id, other_body, text, sig);
    }

    #[test]
    #[should_panic(expected = "request expired")]
    fn rejects_late_seal() {
        let (mut c, key, r) = setup();
        let (body, text, sig) = seal(&key, &r.request_id, COMMIT);
        ctx(2, 0, r.deadline_ns + 1);
        let _ = c.fulfil(r.id, body, text, sig);
    }

    #[test]
    #[should_panic(expected = "deadline has not passed")]
    fn refuses_early_refund() {
        let (mut c, _key, r) = setup();
        let _ = c.refund(r.id);
    }

    #[test]
    fn refunds_after_deadline() {
        let (mut c, _key, r) = setup();
        ctx(0, 0, r.deadline_ns + 1);
        let _ = c.refund(r.id);
        assert_eq!(c.get_request(r.id).unwrap().status, Status::Refunded);
    }
}
