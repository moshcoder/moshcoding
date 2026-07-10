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
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
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
export type CustomDomain = { id: string; domain: string; dnsRecords: DnsRecord[] };

const DOMAINS_QUERY = `
  query($pid: String!, $sid: String!, $eid: String!) {
    domains(projectId: $pid, serviceId: $sid, environmentId: $eid) {
      customDomains {
        id domain
        status { dnsRecords { hostlabel recordType requiredValue currentValue status zone } }
      }
      serviceDomains { domain }
    }
  }`;

/** All custom domains on the service, each with its live DNS-record status. */
export async function listCustomDomains(): Promise<{ customDomains: CustomDomain[]; serviceDomain: string | null }> {
  const d = await gql(DOMAINS_QUERY, { pid: PROJECT_ID, sid: SERVICE_ID, eid: ENVIRONMENT_ID });
  const cds: CustomDomain[] = (d?.domains?.customDomains || []).map((c: any) => ({
    id: c.id,
    domain: c.domain,
    dnsRecords: c.status?.dnsRecords || [],
  }));
  const serviceDomain = d?.domains?.serviceDomains?.[0]?.domain || null;
  return { customDomains: cds, serviceDomain };
}

const CREATE_MUTATION = `
  mutation($input: CustomDomainCreateInput!) {
    customDomainCreate(input: $input) {
      id domain
      status { dnsRecords { hostlabel recordType requiredValue currentValue status zone } }
    }
  }`;

/** Adds one custom domain; returns it with the DNS record the user must set. */
export async function createCustomDomain(domain: string): Promise<CustomDomain> {
  const d = await gql(CREATE_MUTATION, {
    input: { projectId: PROJECT_ID, serviceId: SERVICE_ID, environmentId: ENVIRONMENT_ID, domain },
  });
  const c = d.customDomainCreate;
  return { id: c.id, domain: c.domain, dnsRecords: c.status?.dnsRecords || [] };
}

export async function deleteCustomDomain(id: string): Promise<void> {
  await gql(`mutation($id: String!) { customDomainDelete(id: $id) }`, { id });
}

/** True once every DNS record for the domain is propagated (Railway's view). */
export function isPropagated(cd: CustomDomain): boolean {
  return cd.dnsRecords.length > 0 && cd.dnsRecords.every((r) => r.status === "DNS_RECORD_STATUS_PROPAGATED");
}
