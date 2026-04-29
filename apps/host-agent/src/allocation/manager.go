package allocation

import (
	"encoding/json"
	"fmt"
	"math/rand"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/nasbb/host-agent/src/events"
)

type SFTPProvisioner interface {
	ProvisionUser(alloc *Allocation) error
}

type Manager struct {
	configDir string
	stateDir  string
	reposDir  string
	log       *events.Logger
	sftp      SFTPProvisioner
}

type CreateRequest struct {
	ConnectionName             string `json:"connectionName"`
	QuotaBytes                 int64  `json:"quotaBytes"`
	BandwidthCapBytesPerSecond int64  `json:"bandwidthCapBytesPerSecond"`
	AccessWindowEnabled        bool   `json:"accessWindowEnabled"`
	AccessWindowStart          string `json:"accessWindowStart"`
	AccessWindowEnd            string `json:"accessWindowEnd"`
}

type PatchRequest struct {
	ConnectionName             *string `json:"connectionName,omitempty"`
	QuotaBytes                 *int64  `json:"quotaBytes,omitempty"`
	BandwidthCapBytesPerSecond *int64  `json:"bandwidthCapBytesPerSecond,omitempty"`
	WarningThresholdPercent    *int    `json:"warningThresholdPercent,omitempty"`
	CriticalThresholdPercent   *int    `json:"criticalThresholdPercent,omitempty"`
	AccessWindowEnabled        *bool   `json:"accessWindowEnabled,omitempty"`
	AccessWindowStart          *string `json:"accessWindowStart,omitempty"`
	AccessWindowEnd            *string `json:"accessWindowEnd,omitempty"`
	RetirementGraceDays        *int    `json:"retirementGraceDays,omitempty"`
}

var validTransitions = map[string][]string{
	"DRAFT":       {"PENDING_KEY", "RETIRING"},
	"PENDING_KEY": {"READY", "EXPIRED", "RETIRING"},
	"EXPIRED":     {"PENDING_KEY", "RETIRING"},
	"READY":       {"SUSPENDED", "RETIRING"},
	"SUSPENDED":   {"READY", "RETIRING"},
	"RETIRING":    {"RETIRED"},
}

func NewManager(configDir, stateDir, reposDir string, log *events.Logger, sftp SFTPProvisioner) *Manager {
	return &Manager{
		configDir: configDir,
		stateDir:  stateDir,
		reposDir:  reposDir,
		log:       log,
		sftp:      sftp,
	}
}

func randomAlphanumeric(n int) string {
	const chars = "abcdefghijklmnopqrstuvwxyz0123456789"
	b := make([]byte, n)
	for i := range b {
		b[i] = chars[rand.Intn(len(chars))]
	}
	return string(b)
}

func (m *Manager) Create(req CreateRequest) (*Allocation, error) {
	id := uuid.New().String()
	hexPart := strings.ReplaceAll(id, "-", "")[:12]
	allocID := "alloc_" + hexPart
	matchID := "match-" + randomAlphanumeric(6)
	username := "nabb_" + hexPart[:8]

	now := time.Now().UTC().Format(time.RFC3339)
	alloc := &Allocation{
		SchemaVersion:              1,
		AllocID:                    allocID,
		MatchID:                    matchID,
		ConnectionName:             req.ConnectionName,
		State:                      "DRAFT",
		Username:                   username,
		RepoPath:                   filepath.Join(m.reposDir, username, "repository"),
		QuotaBytes:                 req.QuotaBytes,
		QuotaMode:                  "soft",
		QuotaState:                 "ok",
		QuotaEnforcedSuspend:       false,
		UsedBytes:                  0,
		WarningThresholdPercent:    15,
		CriticalThresholdPercent:   5,
		BandwidthCapBytesPerSecond: req.BandwidthCapBytesPerSecond,
		AccessWindowEnabled:        req.AccessWindowEnabled,
		AccessWindowStart:          req.AccessWindowStart,
		AccessWindowEnd:            req.AccessWindowEnd,
		AccessWindowEnforcement:    "future",
		RetirementGraceDays:        7,
		CreatedAt:                  now,
		UpdatedAt:                  now,
	}

	if err := os.MkdirAll(filepath.Join(m.reposDir, username), 0755); err != nil {
		return nil, err
	}
	if err := os.MkdirAll(filepath.Join(m.reposDir, username, "repository"), 0755); err != nil {
		return nil, err
	}

	if err := m.save(alloc); err != nil {
		return nil, err
	}

	if m.sftp != nil {
		if err := m.sftp.ProvisionUser(alloc); err != nil {
			return nil, err
		}
	}

	m.log.Append("allocation.created", allocID, fmt.Sprintf("allocation created: %s", req.ConnectionName))
	return alloc, nil
}

func (m *Manager) List() ([]*Allocation, error) {
	dir := filepath.Join(m.configDir, "allocations")
	entries, err := os.ReadDir(dir)
	if os.IsNotExist(err) {
		return []*Allocation{}, nil
	}
	if err != nil {
		return nil, err
	}
	var allocs []*Allocation
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		data, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var a Allocation
		if err := json.Unmarshal(data, &a); err != nil {
			continue
		}
		allocs = append(allocs, &a)
	}
	return allocs, nil
}

func (m *Manager) Get(allocID string) (*Allocation, error) {
	path := filepath.Join(m.configDir, "allocations", allocID+".json")
	data, err := os.ReadFile(path)
	if os.IsNotExist(err) {
		return nil, fmt.Errorf("NOT_FOUND")
	}
	if err != nil {
		return nil, err
	}
	var a Allocation
	if err := json.Unmarshal(data, &a); err != nil {
		return nil, err
	}
	return &a, nil
}

func (m *Manager) Update(allocID string, patch PatchRequest) (*Allocation, error) {
	alloc, err := m.Get(allocID)
	if err != nil {
		return nil, err
	}
	if patch.ConnectionName != nil {
		alloc.ConnectionName = *patch.ConnectionName
	}
	if patch.QuotaBytes != nil {
		alloc.QuotaBytes = *patch.QuotaBytes
	}
	if patch.BandwidthCapBytesPerSecond != nil {
		alloc.BandwidthCapBytesPerSecond = *patch.BandwidthCapBytesPerSecond
	}
	if patch.WarningThresholdPercent != nil {
		alloc.WarningThresholdPercent = *patch.WarningThresholdPercent
	}
	if patch.CriticalThresholdPercent != nil {
		alloc.CriticalThresholdPercent = *patch.CriticalThresholdPercent
	}
	if patch.AccessWindowEnabled != nil {
		alloc.AccessWindowEnabled = *patch.AccessWindowEnabled
	}
	if patch.AccessWindowStart != nil {
		alloc.AccessWindowStart = *patch.AccessWindowStart
	}
	if patch.AccessWindowEnd != nil {
		alloc.AccessWindowEnd = *patch.AccessWindowEnd
	}
	if patch.RetirementGraceDays != nil {
		alloc.RetirementGraceDays = *patch.RetirementGraceDays
	}
	return alloc, m.save(alloc)
}

func (m *Manager) Save(alloc *Allocation) error {
	return m.save(alloc)
}

func (m *Manager) save(alloc *Allocation) error {
	alloc.UpdatedAt = time.Now().UTC().Format(time.RFC3339)
	dir := filepath.Join(m.configDir, "allocations")
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	path := filepath.Join(dir, alloc.AllocID+".json")
	data, err := json.MarshalIndent(alloc, "", "  ")
	if err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, data, 0644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func (m *Manager) Transition(alloc *Allocation, newState string) error {
	allowed, ok := validTransitions[alloc.State]
	if !ok {
		return fmt.Errorf("INVALID_STATE")
	}
	found := false
	for _, s := range allowed {
		if s == newState {
			found = true
			break
		}
	}
	if !found {
		return fmt.Errorf("INVALID_STATE")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	switch newState {
	case "PENDING_KEY":
		alloc.InviteExportedAt = now
	case "READY":
		alloc.OwnerKeyImportedAt = now
	case "SUSPENDED":
		alloc.SuspendedAt = now
	case "RETIRING":
		alloc.RetirementInitiatedAt = now
	case "RETIRED":
		alloc.RetiredAt = now
	}

	alloc.State = newState
	return m.save(alloc)
}
