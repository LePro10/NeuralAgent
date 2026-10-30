//! Configuration from the environment (the env file on the server; never in the repository).

use std::net::SocketAddr;
use std::path::PathBuf;

#[derive(Clone, Debug)]
pub struct Provider {
    pub client_id: String,
    pub client_secret: String,
}

#[derive(Clone, Debug)]
pub struct Smtp {
    pub host: String,
    pub port: u16,
    pub user: String,
    pub pass: String,
}

#[derive(Clone, Debug)]
pub struct Config {
    pub bind: SocketAddr,
    /// Public origin, e.g. `https://agent.neuralhub.dev` (OAuth callbacks, mail links).
    pub public_url: String,
    pub db: PathBuf,
    /// Built web files (landing, `/app`, `/admin`); optional.
    pub web: Option<PathBuf>,
    pub github: Option<Provider>,
    pub google: Option<Provider>,
    pub smtp: Option<Smtp>,
    pub mail_from: String,
    pub admins: Vec<String>,
    /// Sign-in without a provider, for tests and local development only.
    pub test_login: bool,
    /// Firebase service-account JSON for FCM (Android push).
    pub fcm: Option<PathBuf>,
    /// Web Push (VAPID) key, base64url; made and kept in the database when unset.
    pub vapid: Option<String>,
    /// Where release builds live (next to the database by default).
    pub releases: Option<PathBuf>,
    /// Bearer token CI uploads releases with; uploads are off without it.
    pub release_token: Option<String>,
}

fn var(k: &str) -> Option<String> {
    std::env::var(k).ok().map(|v| v.trim().to_string()).filter(|v| !v.is_empty())
}

impl Config {
    pub fn from_env() -> anyhow::Result<Config> {
        let provider =
            |p: &str| Some(Provider { client_id: var(&format!("{p}_CLIENT_ID"))?, client_secret: var(&format!("{p}_CLIENT_SECRET"))? });
        let smtp = match (var("SMTP_HOST"), var("SMTP_USER"), var("SMTP_PASS")) {
            (Some(host), Some(user), Some(pass)) => {
                Some(Smtp { host, port: var("SMTP_PORT").and_then(|p| p.parse().ok()).unwrap_or(587), user, pass })
            }
            _ => None,
        };
        let test_login = var("NA_RELAY_TEST_LOGIN").as_deref() == Some("1");
        if test_login && !cfg!(feature = "test-login") {
            anyhow::bail!("NA_RELAY_TEST_LOGIN needs a build with the test-login feature (never in production)");
        }
        Ok(Config {
            bind: var("NA_RELAY_BIND").unwrap_or_else(|| "0.0.0.0:8080".into()).parse()?,
            public_url: var("PUBLIC_URL").unwrap_or_else(|| "https://agent.neuralhub.dev".into()).trim_end_matches('/').to_string(),
            db: var("NA_RELAY_DB").unwrap_or_else(|| "/var/lib/neuralagent/relay.db".into()).into(),
            web: var("NA_RELAY_WEB").map(PathBuf::from),
            github: provider("GITHUB"),
            google: provider("GOOGLE"),
            smtp,
            mail_from: var("MAIL_FROM").unwrap_or_else(|| "agent@neuralhub.dev".into()),
            admins: var("ADMIN_EMAILS")
                .map(|v| v.split(',').map(|e| e.trim().to_lowercase()).filter(|e| !e.is_empty()).collect())
                .unwrap_or_default(),
            test_login,
            fcm: var("FCM_SERVICE_ACCOUNT").map(PathBuf::from),
            vapid: var("VAPID_PRIVATE_KEY"),
            releases: var("NA_RELAY_RELEASES").map(PathBuf::from).or_else(|| {
                let db = PathBuf::from(var("NA_RELAY_DB").unwrap_or_else(|| "/var/lib/neuralagent/relay.db".into()));
                Some(db.parent()?.join("releases"))
            }),
            release_token: var("RELEASE_UPLOAD_TOKEN"),
        })
    }

    /// For tests: everything local, no providers, no mail server.
    pub fn local(public_url: &str) -> Config {
        Config {
            bind: "127.0.0.1:0".parse().unwrap(),
            public_url: public_url.into(),
            db: ":memory:".into(),
            web: None,
            github: None,
            google: None,
            smtp: None,
            mail_from: "agent@neuralhub.dev".into(),
            admins: vec![],
            test_login: cfg!(feature = "test-login"),
            fcm: None,
            vapid: None,
            releases: None,
            release_token: None,
        }
    }

    pub fn providers(&self) -> Vec<&'static str> {
        let mut v = vec![];
        if self.github.is_some() {
            v.push("github");
        }
        if self.google.is_some() {
            v.push("google");
        }
        if self.test_login {
            v.push("test");
        }
        v
    }
}
