/** Shared mocks for OrganizationCleanupService specs. */

type DbMocks = Record<string, Record<string, jest.Mock>>;

export function mockEmptyAssetTables(mockedDb: DbMocks): void {
  mockedDb.organization.findUnique.mockResolvedValue({ logo: null });
  mockedDb.trustResource.findMany.mockResolvedValue([]);
  mockedDb.trustNDAAgreement.findMany.mockResolvedValue([]);
  mockedDb.trustDocument.findMany.mockResolvedValue([]);
  mockedDb.organizationChart.findUnique.mockResolvedValue(null);
  mockedDb.questionnaire.findMany.mockResolvedValue([]);
  mockedDb.knowledgeBaseDocument.findMany.mockResolvedValue([]);
  mockedDb.evidenceAutomationVersion.findMany.mockResolvedValue([]);
  mockedDb.attachment.findMany.mockResolvedValue([]);
  mockedDb.securityQuestionnaireManualAnswer.findMany.mockResolvedValue([]);
}

/** Route S3 calls by command shape: list commands carry Prefix, deletes carry Delete. */
export function mockListThenDelete(
  mockSend: jest.Mock,
  {
    listedByBucket,
  }: {
    listedByBucket: Record<string, string[]>;
  },
): void {
  mockSend.mockImplementation(
    (command: {
      Bucket?: string;
      Prefix?: string;
      Delete?: { Objects: Array<{ Key?: string }> };
    }) => {
      if (command.Prefix !== undefined) {
        const keys = listedByBucket[command.Bucket ?? ''] ?? [];
        return Promise.resolve({
          Contents: keys.map((Key) => ({ Key })),
          IsTruncated: false,
        });
      }
      return Promise.resolve({ Errors: [] });
    },
  );
}
