import { describe, expect, it } from 'vitest';
import { createNewTemplateSchema } from './NewTemplateDialog';
import { createTemplateSchema } from './TemplateEditor';

const newMessages = { name: 'name-msg', framework: 'framework-msg', cycle: 'cycle-msg' };
const templateMessages = {
  phaseName: 'phase-name-msg',
  durationMin: 'duration-msg',
  templateName: 'template-name-msg',
  frameworkId: 'framework-id-msg',
  cycle: 'cycle-msg',
};

describe('timeline template schemas carry translated messages', () => {
  it('reports the translated name message for an empty template name', () => {
    const result = createNewTemplateSchema(newMessages).safeParse({
      name: '',
      frameworkId: 'fw-1',
      cycleNumber: 1,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe('name-msg');
    }
  });

  it('reports the translated framework and cycle messages', () => {
    const parsed = createNewTemplateSchema(newMessages).safeParse({
      name: 'SOC 2',
      frameworkId: '',
      cycleNumber: 0,
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      const messages = parsed.error.issues.map((issue) => issue.message);
      expect(messages).toContain('framework-msg');
      expect(messages).toContain('cycle-msg');
    }
  });

  it('reports the translated phase name message for an empty phase', () => {
    const result = createTemplateSchema(templateMessages).safeParse({
      name: 'SOC 2',
      frameworkId: 'fw-1',
      cycleNumber: 1,
      phases: [
        {
          name: '',
          defaultDurationWeeks: 2,
          completionType: 'MANUAL',
        },
      ],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const messages = result.error.issues.map((issue) => issue.message);
      expect(messages).toContain('phase-name-msg');
    }
  });

  it('accepts a fully valid template without errors', () => {
    const result = createTemplateSchema(templateMessages).safeParse({
      name: 'SOC 2',
      frameworkId: 'fw-1',
      cycleNumber: 1,
      phases: [
        {
          name: 'Phase 1',
          defaultDurationWeeks: 2,
          completionType: 'MANUAL',
        },
      ],
    });

    expect(result.success).toBe(true);
  });
});
