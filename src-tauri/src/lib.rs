// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
use chacha20poly1305::{
    aead::{Aead, KeyInit, Payload},
    ChaCha20Poly1305, Nonce,
};
use rand::Rng;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CachedCity {
    pub id: i32,
    pub name: String,
    pub latitude: f64,
    pub longitude: f64,
    pub country: String,
    pub admin1: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct CachedWeatherData {
    pub city: CachedCity,
    pub weather_json: String,
    pub timestamp: u64,
}

#[derive(Debug, Serialize)]
pub struct ApiError {
    pub code: String,
    pub message: String,
}

impl ApiError {
    fn new(code: &str, message: &str) -> Self {
        ApiError {
            code: code.to_string(),
            message: message.to_string(),
        }
    }
}

fn get_app_data_dir() -> Result<PathBuf, ApiError> {
    let data_dir = dirs_next::data_dir()
        .ok_or_else(|| ApiError::new("CONFIG_ERROR", "Could not determine data directory"))?;
    let app_dir = data_dir.join("weather-app");

    fs::create_dir_all(&app_dir)
        .map_err(|e| ApiError::new("IO_ERROR", &format!("Failed to create app directory: {}", e)))?;

    Ok(app_dir)
}

fn get_cache_file() -> Result<PathBuf, ApiError> {
    let app_dir = get_app_data_dir()?;
    Ok(app_dir.join("weather_cache.bin"))
}

fn get_encryption_key() -> Result<[u8; 32], ApiError> {
    let entry = keyring::Entry::new("weather-app", "encryption-key")
        .map_err(|e| ApiError::new("KEYRING_ERROR", &format!("Keyring error: {}", e)))?;

    let key_str = match entry.get_password() {
        Ok(pwd) => pwd,
        Err(_) => {
            // Generate new key if it doesn't exist
            let mut rng = rand::thread_rng();
            let mut key_bytes = [0u8; 32];
            rng.fill(&mut key_bytes);
            let key_b64 = base64::encode(&key_bytes);
            entry.set_password(&key_b64)
                .map_err(|e| ApiError::new("KEYRING_ERROR", &format!("Failed to store key: {}", e)))?;
            key_b64
        }
    };

    let key_bytes = base64::decode(&key_str)
        .map_err(|e| ApiError::new("CRYPTO_ERROR", &format!("Invalid key format: {}", e)))?;

    if key_bytes.len() != 32 {
        return Err(ApiError::new("CRYPTO_ERROR", "Invalid key length"));
    }

    let mut key_array = [0u8; 32];
    key_array.copy_from_slice(&key_bytes);
    Ok(key_array)
}

fn encrypt_data(data: &[u8]) -> Result<Vec<u8>, ApiError> {
    let key = get_encryption_key()?;
    let cipher = ChaCha20Poly1305::new(key.as_ref().into());

    let mut rng = rand::thread_rng();
    let mut nonce_bytes = [0u8; 12];
    rng.fill(&mut nonce_bytes);
    let nonce = Nonce::from_slice(&nonce_bytes);

    let ciphertext = cipher
        .encrypt(nonce, Payload::from(data))
        .map_err(|e| ApiError::new("CRYPTO_ERROR", &format!("Encryption failed: {}", e)))?;

    let mut result = nonce_bytes.to_vec();
    result.extend_from_slice(&ciphertext);
    Ok(result)
}

fn decrypt_data(encrypted: &[u8]) -> Result<Vec<u8>, ApiError> {
    if encrypted.len() < 12 {
        return Err(ApiError::new("CRYPTO_ERROR", "Invalid encrypted data"));
    }

    let key = get_encryption_key()?;
    let cipher = ChaCha20Poly1305::new(key.as_ref().into());

    let (nonce_bytes, ciphertext) = encrypted.split_at(12);
    let nonce = Nonce::from_slice(nonce_bytes);

    let plaintext = cipher
        .decrypt(nonce, Payload::from(ciphertext))
        .map_err(|e| ApiError::new("CRYPTO_ERROR", &format!("Decryption failed: {}", e)))?;

    Ok(plaintext)
}

#[tauri::command]
pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
pub fn get_cached() -> Result<Vec<CachedWeatherData>, ApiError> {
    let cache_file = get_cache_file()?;

    if !cache_file.exists() {
        return Ok(Vec::new());
    }

    let encrypted = fs::read(&cache_file)
        .map_err(|e| ApiError::new("IO_ERROR", &format!("Failed to read cache: {}", e)))?;

    let decrypted = decrypt_data(&encrypted)?;
    let cached: Vec<CachedWeatherData> = serde_json::from_slice(&decrypted)
        .map_err(|e| ApiError::new("PARSE_ERROR", &format!("Failed to parse cache: {}", e)))?;

    Ok(cached)
}

#[tauri::command]
pub fn upsert_cached(city: CachedCity, weather_json: String) -> Result<(), ApiError> {
    let mut cached = get_cached()?;
    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| ApiError::new("TIME_ERROR", &format!("Time error: {}", e)))?
        .as_secs();

    // Find and update or insert
    if let Some(pos) = cached.iter().position(|c| c.city.id == city.id && c.city.latitude == city.latitude && c.city.longitude == city.longitude) {
        cached[pos].weather_json = weather_json;
        cached[pos].timestamp = timestamp;
    } else {
        cached.push(CachedWeatherData {
            city,
            weather_json,
            timestamp,
        });
    }

    let json = serde_json::to_vec(&cached)
        .map_err(|e| ApiError::new("PARSE_ERROR", &format!("Failed to serialize: {}", e)))?;

    let encrypted = encrypt_data(&json)?;
    let cache_file = get_cache_file()?;

    fs::write(&cache_file, &encrypted)
        .map_err(|e| ApiError::new("IO_ERROR", &format!("Failed to write cache: {}", e)))?;

    Ok(())
}

#[tauri::command]
pub fn remove_cached(id: i32, latitude: f64, longitude: f64) -> Result<(), ApiError> {
    let mut cached = get_cached()?;
    cached.retain(|c| !(c.city.id == id && c.city.latitude == latitude && c.city.longitude == longitude));

    let json = serde_json::to_vec(&cached)
        .map_err(|e| ApiError::new("PARSE_ERROR", &format!("Failed to serialize: {}", e)))?;

    let encrypted = encrypt_data(&json)?;
    let cache_file = get_cache_file()?;

    fs::write(&cache_file, &encrypted)
        .map_err(|e| ApiError::new("IO_ERROR", &format!("Failed to write cache: {}", e)))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            get_cached,
            upsert_cached,
            remove_cached
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
