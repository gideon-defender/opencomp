import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const databaseUrl = process.env.CANDIDATE_INTAKE_TEST_DATABASE_URL;
const migration = readFileSync(
  resolve(
    import.meta.dirname,
    '../prisma/migrations/20261014160000_candidate_screening_intake/migration.sql',
  ),
  'utf8',
);
let schema: string;
function query(sql: string) {
  if (!databaseUrl) throw new Error('CANDIDATE_INTAKE_TEST_DATABASE_URL is required');
  return execFileSync(
    process.env.PSQL_BIN ?? 'psql',
    [databaseUrl, '-X', '-At', '-v', 'ON_ERROR_STOP=1', '-c', sql],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        PGOPTIONS: `-c search_path=${schema},public -c statement_timeout=15000`,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    },
  ).trim();
}

describe.skipIf(!databaseUrl)('candidate intake migration', () => {
  beforeEach(() => {
    schema = `candidate_intake_${randomUUID().replaceAll('-', '')}`;
    query(`CREATE SCHEMA "${schema}";
      CREATE TABLE "Organization" (id text PRIMARY KEY);
      CREATE TABLE secrets (id text PRIMARY KEY, organization_id text NOT NULL);
      CREATE FUNCTION generate_prefixed_cuid(prefix text) RETURNS text LANGUAGE sql AS
      $$ SELECT prefix || '_' || gen_random_uuid()::text $$;
      INSERT INTO "Organization" VALUES ('tenant_a'), ('tenant_b');
      INSERT INTO secrets VALUES ('secret_a', 'tenant_a'), ('secret_b', 'tenant_b');`);
    query(migration);
    query(`INSERT INTO people_candidates (id,"organizationId",email,"firstName","lastName","updatedAt")
      VALUES ('candidate_a','tenant_a','a@b.com','A','B',now()),('candidate_b','tenant_b','a@b.com','A','B',now());
      INSERT INTO checkr_intake_connections (id,"organizationId","accountId","apiKeySecretId",environment,package,"updatedAt")
      VALUES ('conn_a','tenant_a','account_a','secret_a','sandbox','basic',now()),
        ('conn_b','tenant_b','account_b','secret_b','sandbox','basic',now());`);
  });
  afterEach(() => query(`DROP SCHEMA "${schema}" CASCADE`));

  it('allows the same normalized email in distinct tenants and rejects same-tenant duplicates', () => {
    expect(query('SELECT count(*) FROM people_candidates')).toBe('2');
    expect(() =>
      query(`INSERT INTO people_candidates ("organizationId",email,"firstName","lastName","updatedAt")
      VALUES ('tenant_a','a@b.com','A','B',now())`),
    ).toThrow();
    expect(() =>
      query(`INSERT INTO people_candidates ("organizationId",email,"firstName","lastName","updatedAt")
      VALUES ('tenant_a',' A@B.COM ','A','B',now())`),
    ).toThrow();
  });

  it('rejects cross-tenant secrets and shared Checkr accounts', () => {
    expect(() =>
      query(`UPDATE checkr_intake_connections SET "apiKeySecretId"='secret_b' WHERE id='conn_a'`),
    ).toThrow();
    expect(() =>
      query(`UPDATE checkr_intake_connections SET "accountId"='account_b' WHERE id='conn_a'`),
    ).toThrow();
  });

  it('enforces candidate/connection tenant ownership on screening records', () => {
    const insert = (candidateId: string, connectionId: string) =>
      query(`
      INSERT INTO candidate_screenings ("organizationId","candidateId","connectionId","operationId",email,"firstName","lastName",country,package,"updatedAt")
      VALUES ('tenant_a','${candidateId}','${connectionId}','op_1','a@b.com','A','B','US','basic',now())`);
    expect(() => insert('candidate_b', 'conn_a')).toThrow();
    expect(() => insert('candidate_a', 'conn_b')).toThrow();
    insert('candidate_a', 'conn_a');
    expect(() => insert('candidate_a', 'conn_a')).toThrow();
    expect(() => query(`DELETE FROM people_candidates WHERE id='candidate_a'`)).toThrow();
  });

  it('installs tenant row policies on all intake tables', () => {
    expect(
      query(
        `SELECT count(*) FROM pg_policies WHERE schemaname='${schema}' AND policyname='tenant_isolation'`,
      ),
    ).toBe('3');
  });

  it('enforces row visibility for the tenant application role', () => {
    query(`GRANT USAGE ON SCHEMA "${schema}" TO comp_app;
      GRANT SELECT ON ALL TABLES IN SCHEMA "${schema}" TO comp_app;`);
    const visible = query(`BEGIN; SELECT set_config('app.tenant_id','tenant_a',true);
      SET LOCAL ROLE comp_app;
      SELECT 'visible=' || count(*) FROM people_candidates;
      SELECT 'account=' || "accountId" FROM checkr_intake_connections;
      ROLLBACK;`);
    expect(visible).toContain('visible=1');
    expect(visible).toContain('account=account_a');
    expect(visible).not.toContain('account_b');
    const unscoped = query(`BEGIN; SELECT set_config('app.tenant_id','',true);
      SET LOCAL ROLE comp_app; SELECT 'visible=' || count(*) FROM people_candidates; ROLLBACK;`);
    expect(unscoped).toContain('visible=0');
  });
});
