//! `core-fetch` — validate + fetch web-hosted form files.
//!
//! A native app is **not CORS-bound**, so it can download a public form directly
//! (inbound; no user data goes up). But a user-supplied URL is an SSRF-style risk,
//! so we validate it: http/https only, and block private / loopback / link-local
//! hosts. The actual byte transfer is done by the app's HTTP layer (Tauri), which
//! calls [`validate_url`] first.
#![forbid(unsafe_code)]
#![warn(missing_docs)]

use url::Url;

/// Largest form download we accept (guards memory + IPC).
pub const MAX_BYTES: usize = 25 * 1024 * 1024;

/// Why a URL was rejected or a download failed.
#[derive(Debug, PartialEq, Eq)]
pub enum FetchError {
    /// Not a parseable http/https URL.
    InvalidUrl,
    /// Host is private / loopback / link-local and not allowed.
    Blocked,
    /// The HTTP request itself failed (network, TLS, non-2xx status).
    Request,
    /// The response exceeded [`MAX_BYTES`].
    TooLarge,
}

impl std::fmt::Display for FetchError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            FetchError::InvalidUrl => write!(f, "not a valid http(s) URL"),
            FetchError::Blocked => write!(f, "host is not allowed (private/loopback/link-local)"),
            FetchError::Request => write!(f, "the download request failed"),
            FetchError::TooLarge => write!(f, "the file is larger than the {MAX_BYTES} byte limit"),
        }
    }
}
impl std::error::Error for FetchError {}

fn is_blocked_host(host: &str) -> bool {
    let h = host.to_lowercase();
    h == "localhost"
        || h == "0.0.0.0"
        || h == "::1"
        || h.starts_with("127.")
        || h.starts_with("10.")
        || h.starts_with("192.168.")
        || h.starts_with("169.254.") // link-local / cloud metadata
        || is_172_private(&h)
        || h.ends_with(".internal")
        || h.ends_with(".local")
}

fn is_172_private(h: &str) -> bool {
    // 172.16.0.0 – 172.31.255.255
    if let Some(rest) = h.strip_prefix("172.") {
        if let Some(dot) = rest.find('.') {
            if let Ok(second) = rest[..dot].parse::<u8>() {
                return (16..=31).contains(&second);
            }
        }
    }
    false
}

/// Validate a user-supplied form URL. Returns the parsed URL or a [`FetchError`].
pub fn validate_url(raw: &str) -> Result<Url, FetchError> {
    let u = Url::parse(raw).map_err(|_| FetchError::InvalidUrl)?;
    if !matches!(u.scheme(), "http" | "https") {
        return Err(FetchError::InvalidUrl);
    }
    match u.host_str() {
        Some(host) if !is_blocked_host(host) => Ok(u),
        Some(_) => Err(FetchError::Blocked),
        None => Err(FetchError::InvalidUrl),
    }
}

/// Download a web-hosted form file on-device. Validates the URL, then GETs it with:
/// http(s) only, every redirect hop re-validated (SSRF guard through redirects),
/// a 30s timeout, and a [`MAX_BYTES`] size cap. Inbound only — no user data goes up.
pub async fn fetch_form(raw: &str) -> Result<Vec<u8>, FetchError> {
    let url = validate_url(raw)?;
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 {
                return attempt.stop();
            }
            match validate_url(attempt.url().as_str()) {
                Ok(_) => attempt.follow(),
                Err(_) => attempt.stop(), // redirect to a blocked/invalid host → don't follow
            }
        }))
        .timeout(std::time::Duration::from_secs(30))
        .user_agent(concat!("ProjectPDFs/", env!("CARGO_PKG_VERSION")))
        .build()
        .map_err(|_| FetchError::Request)?;

    let resp = client.get(url).send().await.map_err(|_| FetchError::Request)?;
    if !resp.status().is_success() {
        return Err(FetchError::Request);
    }
    if let Some(len) = resp.content_length() {
        if len as usize > MAX_BYTES {
            return Err(FetchError::TooLarge);
        }
    }
    let bytes = resp.bytes().await.map_err(|_| FetchError::Request)?;
    if bytes.len() > MAX_BYTES {
        return Err(FetchError::TooLarge);
    }
    Ok(bytes.to_vec())
}

/// Returns this crate's stable module name.
pub fn module_name() -> &'static str {
    "core-fetch"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_public_form_urls() {
        assert!(validate_url("https://passport.gov.example/form.pdf").is_ok());
        assert!(validate_url("http://forms.example.org/apply").is_ok());
    }

    #[test]
    fn rejects_bad_scheme_and_no_host() {
        assert_eq!(validate_url("ftp://x/y"), Err(FetchError::InvalidUrl));
        assert_eq!(validate_url("not a url"), Err(FetchError::InvalidUrl));
        assert_eq!(validate_url("file:///etc/passwd"), Err(FetchError::InvalidUrl));
    }

    #[test]
    fn blocks_private_and_metadata_hosts() {
        for bad in [
            "http://localhost/x",
            "https://127.0.0.1/x",
            "https://10.1.2.3/x",
            "https://192.168.0.1/x",
            "https://169.254.169.254/latest", // cloud metadata
            "https://172.16.0.1/x",
            "https://db.internal/x",
        ] {
            assert_eq!(validate_url(bad), Err(FetchError::Blocked), "should block {bad}");
        }
        // 172.32 is public
        assert!(validate_url("https://172.32.0.1/x").is_ok());
    }

    #[test]
    fn module_name_is_stable() {
        assert_eq!(module_name(), "core-fetch");
    }
}
