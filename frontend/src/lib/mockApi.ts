import { GraphPayload, ScanRequest } from "../types/osint.types";

// Simulates a real OSINT scan initiation (returns a scan ID after ~1s)
const startScan = async (_req: ScanRequest): Promise<string> => {
  return new Promise((resolve) =>
    setTimeout(() => resolve(`scan_${Date.now()}`), 1000)
  );
};

// Returns a rich mock graph after 1.5s, simulating async OSINT enrichment
const fetchGraphForScan = async (_scanId: string): Promise<GraphPayload> => {
  return new Promise((resolve) =>
    setTimeout(() => {
      resolve({
        nodes: [
          { id: "1", label: "hedefdomain.com",         group: "domain" },
          { id: "2", label: "203.0.113.55",             group: "ip"     },
          { id: "3", label: "admin@hedefdomain.com",    group: "email"  },
          { id: "4", label: "github.com/target_repo",   group: "social" },
          { id: "5", label: "198.51.100.12",            group: "ip"     },
          { id: "6", label: "support@hedefdomain.com",  group: "email"  },
        ],
        links: [
          { source: "1", target: "2", label: "resolves_to"  },
          { source: "1", target: "3", label: "has_email"    },
          { source: "3", target: "4", label: "commits_to"   },
          { source: "1", target: "5", label: "alt_record"   },
          { source: "1", target: "6", label: "has_email"    },
        ],
      });
    }, 1500)
  );
};

export const mockApi = { startScan, fetchGraphForScan };