jest.mock('@db', () => ({
  db: { securityQuestionnaireManualAnswer: { findMany: jest.fn() } },
}));
jest.mock('@gideon-defender/db', () => ({
  EMBEDDING_IDENTITY: 'bedrock:titan:1024',
}));
jest.mock('../core/upsert-embedding', () => ({
  batchUpsertEmbeddings: jest.fn(),
}));
import { db } from '@db';
import { batchUpsertEmbeddings } from '../core/upsert-embedding';
import { syncManualAnswers } from './sync-manual-answers';
const updatedAt = new Date('2026-10-11T00:00:00Z');
beforeEach(() => {
  jest.clearAllMocks();
  jest
    .mocked(db.securityQuestionnaireManualAnswer.findMany)
    .mockResolvedValue([]);
});
describe('manual answer model changes', () => {
  it('rebuilds unchanged manual answers with legacy vectors', async () => {
    const findMany = db.securityQuestionnaireManualAnswer.findMany as jest.Mock;
    findMany.mockResolvedValue([
      { id: 'answer_1', question: 'Question', answer: 'Answer', updatedAt },
    ]);
    const result = await syncManualAnswers(
      'org_1',
      new Map([
        [
          'answer_1',
          [
            {
              id: 'manual_answer_answer_1',
              sourceId: 'answer_1',
              sourceType: 'manual_answer',
              updatedAt: updatedAt.toISOString(),
              embeddingModel: null,
            },
          ],
        ],
      ]),
    );
    expect(result.updated).toBe(1);
    expect(batchUpsertEmbeddings).toHaveBeenCalledWith([
      expect.objectContaining({
        id: 'manual_answer_answer_1',
        metadata: expect.objectContaining({ organizationId: 'org_1' }),
      }),
    ]);
  });
});
