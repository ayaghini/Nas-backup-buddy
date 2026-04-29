package allocation

type Allocation struct {
	SchemaVersion              int    `json:"schemaVersion"`
	AllocID                    string `json:"allocId"`
	MatchID                    string `json:"matchId"`
	ConnectionName             string `json:"connectionName"`
	State                      string `json:"state"`
	Username                   string `json:"username"`
	RepoPath                   string `json:"repoPath"`
	QuotaBytes                 int64  `json:"quotaBytes"`
	QuotaMode                  string `json:"quotaMode"`
	QuotaState                 string `json:"quotaState"`
	QuotaEnforcedSuspend       bool   `json:"quotaEnforcedSuspend"`
	UsedBytes                  int64  `json:"usedBytes"`
	WarningThresholdPercent    int    `json:"warningThresholdPercent"`
	CriticalThresholdPercent   int    `json:"criticalThresholdPercent"`
	OwnerDeviceLabel           string `json:"ownerDeviceLabel"`
	OwnerPublicKey             string `json:"ownerPublicKey,omitempty"`
	InviteExpiresAt            string `json:"inviteExpiresAt"`
	InviteExportedAt           string `json:"inviteExportedAt"`
	OwnerKeyImportedAt         string `json:"ownerKeyImportedAt"`
	SuspendedAt                string `json:"suspendedAt"`
	RetirementInitiatedAt      string `json:"retirementInitiatedAt"`
	RetirementGraceDays        int    `json:"retirementGraceDays"`
	RetiredAt                  string `json:"retiredAt"`
	BandwidthCapBytesPerSecond int64  `json:"bandwidthCapBytesPerSecond"`
	AccessWindowEnabled        bool   `json:"accessWindowEnabled"`
	AccessWindowStart          string `json:"accessWindowStart"`
	AccessWindowEnd            string `json:"accessWindowEnd"`
	AccessWindowEnforcement    string `json:"accessWindowEnforcement"`
	LastQuotaCheckAt           string `json:"lastQuotaCheckAt"`
	LastOwnerWriteAt           string `json:"lastOwnerWriteAt"`
	CreatedAt                  string `json:"createdAt"`
	UpdatedAt                  string `json:"updatedAt"`
}

func (a *Allocation) Summary() Allocation {
	cp := *a
	cp.OwnerPublicKey = ""
	return cp
}
