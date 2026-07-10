// Minimal Railway GraphQL client for self-serve custom domains. Lets the admin
// dashboard point a parked domain straight at this service via DNS (ALIAS at the
// apex + CNAME on www) — no iframes, no forwarding — and verify propagation.
//
// Needs RAILWAY_API_TOKEN (a Railway account/team token) in the env. The
// project/service/environment default to this deployment but can be overridden.
const ENDPOINT = "https://backboard.railway.com/graphql/v2";

const PROJECT_ID = process.env.RAILWAY_PROJECT_ID || "e12258c5-050a-462d-a54c-b4c98939fe6f";
const SERVICE_ID = process.env.RAILWAY_SERVICE_ID || "0aca36d5-e800-4099-ba55-10f89c65ce3a";
const ENVIRONMENT_ID = process.env.RAILWAY_ENVIRONMENT_ID || "1070bfbd-cea8-4c0b-ae98-338694fcb11e";

export function railwayConfigured(): boolean {
  return Boolean(process.env.RAILWAY_API_TOKEN);
}

async function gql<T = any>(query: string, variables: Record<string, any> = {}): Promise<T> {
  const token = process.env.RAILWAY_API_TOKEN;
  if (!token) throw new Error("RAILWAY_API_TOKEN is not set.");
  // Project tokens (UUID) authenticate with the Project-Access-Token header;
  // team/personal tokens use Authorization: Bearer.
  const isProjectToken = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(token);
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (isProjectToken) headers["Project-Access-Token"] = token;
  else headers["authorization"] = `Bearer ${token}`;
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json().catch(() => ({}));
  if (json.errors?.length) throw new Error(json.errors.map((e: any) => e.message).join("; "));
  if (!res.ok) throw new Error(`Railway API ${res.status}`);
  return json.data as T;
}

export type DnsRecord = {
  hostlabel: string;
  recordType: string; // e.g. DNS_RECORD_TYPE_CNAME
  requiredValue: string;
  currentValue: string;
  status: string; // e.g. DNS_RECORD_STATUS_PROPAGATED
  zone: string;
};
export type CustomDomain = {
  id: string;
  domain: string;
  dnsRecords: DnsRecord[];
  // Railway proves you own the domain via a TXT record BEFORE it issues a cert.
  // A correct ALIAS/CNAME alone leaves the domain stuck "validating ownership".
  verified: boolean;
  verificationDnsHost: string; // e.g. "_railway-verify" (apex) or "_railway-verify.www"
  verificationToken: string; // e.g. "railway-verify=<hex>" — the TXT value to set
  certificateStatus: string; // e.g. CERTIFICATE_STATUS_TYPE_VALID
};

const DOMAIN_STATUS_FIELDS = `
  status {
    certificateStatus verified verificationDnsHost verificationToken
    dnsRecords { hostlabel recordType requiredValue currentValue status zone }
  }`;

function toCustomDomain(c: any): CustomDomain {
  const s = c?.status || {};
  return {
    id: c.id,
    domain: c.domain,
    dnsRecords: s.dnsRecords || [],
    verified: Boolean(s.verified),
    verificationDnsHost: s.verificationDnsHost || "",
    verificationToken: s.verificationToken || "",
    certificateStatus: s.certificateStatus || "",
  };
}

const DOMAINS_QUERY = `
  query($pid: String!, $sid: String!, $eid: String!) {
    domains(projectId: $pid, serviceId: $sid, environmentId: $eid) {
      customDomains { id domain ${DOMAIN_STATUS_FIELDS} }
      serviceDomains { domain }
    }
  }`;

/** All custom domains on the service, each with its live DNS-record status. */
export async function listCustomDomains(): Promise<{ customDomains: CustomDomain[]; serviceDomain: string | null }> {
  const d = await gql(DOMAINS_QUERY, { pid: PROJECT_ID, sid: SERVICE_ID, eid: ENVIRONMENT_ID });
  const cds: CustomDomain[] = (d?.domains?.customDomains || []).map(toCustomDomain);
  const serviceDomain = d?.domains?.serviceDomains?.[0]?.domain || null;
  return { customDomains: cds, serviceDomain };
}

const CREATE_MUTATION = `
  mutation($input: CustomDomainCreateInput!) {
    customDomainCreate(input: $input) { id domain ${DOMAIN_STATUS_FIELDS} }
  }`;

/** Adds one custom domain; returns it with the DNS records the user must set. */
export async function createCustomDomain(domain: string): Promise<CustomDomain> {
  const d = await gql(CREATE_MUTATION, {
    input: { projectId: PROJECT_ID, serviceId: SERVICE_ID, environmentId: ENVIRONMENT_ID, domain },
  });
  return toCustomDomain(d.customDomainCreate);
}

export async function deleteCustomDomain(id: string): Promise<void> {
  await gql(`mutation($id: String!) { customDomainDelete(id: $id) }`, { id });
}

/** True once every DNS record for the domain is propagated (Railway's view). */
export function isPropagated(cd: CustomDomain): boolean {
  return cd.dnsRecords.length > 0 && cd.dnsRecords.every((r) => r.status === "DNS_RECORD_STATUS_PROPAGATED");
}
