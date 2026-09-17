import { Test, TestingModule } from '@nestjs/testing';
import { EvaluationService } from './evaluation.service';
import { SupabaseService } from '../../common/services/supabase.service';

function mockQuery(resolveTo: any) {
  const q: any = {
    select: jest.fn(() => q),
    eq: jest.fn(() => q),
    in: jest.fn(() => q),
    upsert: jest.fn(() => q),
    update: jest.fn(() => q),
    single: jest.fn().mockResolvedValue(resolveTo),
    maybeSingle: jest.fn().mockResolvedValue(resolveTo),
  };
  q.then = (onF: any) => Promise.resolve(resolveTo).then(onF);
  return q;
}
function setupFrom(client: any, results: any[]) {
  let i = 0;
  client.from.mockImplementation(() => {
    const r = results[Math.min(i, results.length - 1)];
    i++;
    return mockQuery(r);
  });
}

describe('EvaluationService Phase28', () => {
  let service: EvaluationService;
  let client: any;
  beforeEach(async () => {
    client = { from: jest.fn(), storage: { from: jest.fn().mockReturnValue({ createSignedUrl: jest.fn().mockResolvedValue({ data: { signedUrl: 'https://signed' }, error: null }) }) } };
    const module: TestingModule = await Test.createTestingModule({
      providers: [EvaluationService, { provide: SupabaseService, useValue: { client } }],
    }).compile();
    service = module.get(EvaluationService);
  });

  it('image_based correct auto-graded', () => {
    const r = (service as any).evaluateAnswer('image_based', 'A', 'A');
    expect(r).toBe(true);
    const r2 = (service as any).evaluateAnswer('image_based', 'B', 'A');
    expect(r2).toBe(false);
    const r3 = (service as any).evaluateAnswer('image_based', 'A', 'a');
    expect(r3).toBe(false); // case-sensitive
  });

  it('mcq alias treated as single_choice', async () => {
    const normalized = (service as any).normalizeQuestionType('mcq');
    expect(normalized).toBe('single_choice');
    const alias2 = (service as any).normalizeQuestionType('MCQ');
    expect(alias2).toBe('single_choice');
  });
});
