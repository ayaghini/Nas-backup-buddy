package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"time"
)

type Config struct {
	SchemaVersion                  int       `json:"schemaVersion"`
	HostLabel                      string    `json:"hostLabel"`
	StorageRoot                    string    `json:"storageRoot"`
	AdvertisedCapacityBytes        int64     `json:"advertisedCapacityBytes"`
	DefaultQuotaBytes              int64     `json:"defaultQuotaBytes"`
	DefaultWarningThresholdPercent int       `json:"defaultWarningThresholdPercent"`
	DefaultCriticalThresholdPercent int      `json:"defaultCriticalThresholdPercent"`
	SFTPPort                       int       `json:"sftpPort"`
	SFTPBindAddress                string    `json:"sftpBindAddress"`
	BandwidthCapBytesPerSecond     int64     `json:"bandwidthCapBytesPerSecond"`
	CreatedAt                      time.Time `json:"createdAt"`
	UpdatedAt                      time.Time `json:"updatedAt"`
}

func defaults() *Config {
	now := time.Now().UTC()
	return &Config{
		SchemaVersion:                   1,
		HostLabel:                       "My NAS",
		StorageRoot:                     "/repos",
		AdvertisedCapacityBytes:         0,
		DefaultQuotaBytes:               53687091200,
		DefaultWarningThresholdPercent:  15,
		DefaultCriticalThresholdPercent: 5,
		SFTPPort:                        2222,
		SFTPBindAddress:                 "127.0.0.1",
		BandwidthCapBytesPerSecond:      0,
		CreatedAt:                       now,
		UpdatedAt:                       now,
	}
}

func Load(configDir string) (*Config, error) {
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return nil, err
	}
	path := filepath.Join(configDir, "config.json")
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		cfg := defaults()
		if err := Save(cfg, configDir); err != nil {
			return nil, err
		}
		return cfg, nil
	}
	if err != nil {
		return nil, err
	}
	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, err
	}
	return &cfg, nil
}

func Save(cfg *Config, configDir string) error {
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return err
	}
	cfg.UpdatedAt = time.Now().UTC()
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return err
	}
	path := filepath.Join(configDir, "config.json")
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func LoadOrSetToken(configDir string) (token string, newly bool, err error) {
	if err := os.MkdirAll(configDir, 0755); err != nil {
		return "", false, err
	}
	tokenPath := filepath.Join(configDir, "agent.token")

	if t := os.Getenv("NASBB_API_TOKEN"); t != "" {
		if err := os.WriteFile(tokenPath, []byte(t), 0600); err != nil {
			return "", false, err
		}
		return t, false, nil
	}

	data, err := os.ReadFile(tokenPath)
	if err == nil {
		return string(data), false, nil
	}
	if !os.IsNotExist(err) {
		return "", false, err
	}

	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", false, err
	}
	t := hex.EncodeToString(b)
	if err := os.WriteFile(tokenPath, []byte(t), 0600); err != nil {
		return "", false, err
	}
	return t, true, nil
}
