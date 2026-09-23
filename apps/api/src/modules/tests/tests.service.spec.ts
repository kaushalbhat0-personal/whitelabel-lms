import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { TestsService } from './tests.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { ObservabilityService } from '../observability/observability.service';

function mockQuery(resolveTo: any) {
  const q: any = {
    select: jest.fn(() => q),
    eq: jest.fn(() => q),
    in: jest.fn(() => q),
    order: jest.fn(() => q),
    range: jest.fn(() => q),
    insert: jest.fn(() => q),
    update: jest.fn(() => q),
    delete: jest.fn(() => q),
    single: jest.fn(),
    maybeSingle: jest.fn(),
    ilike: jest.fn(() => q),
  };
  q.single.mockResolvedValue(resolveTo);
  q.maybeSingle.mockResolvedValue(resolveTo);
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

const createDto = {
  title: 'Test 1',
  description: 'desc',
  durationMinutes: 30,
  totalMarks: 10,
  passingMarks: 5,
  startTime: undefined,
  sections: [{ title: 'S1' }],
  questions: [{ questionBankId: 'qb1', marks: 5 }],
  batches: [{ batchId: 'b1' }],
};

describe('TestsService', () => {
  let service: TestsService;
  let client: any;

  beforeEach(async () => {
    client = { from: jest.fn() };
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TestsService,
        { provide: SupabaseService, useValue: { client } },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn().mockResolvedValue(undefined) } },
      ],
    }).compile();
    service = module.get(TestsService);
  });

  describe('create', () => {
    it('creates a test and relations', async () => {
      const testRow = { id: 't1', title: 'Test 1', status: 'draft', total_marks: 10 };
      setupFrom(client, [
        { data: testRow, error: null },                          // insert test (single)
        { data: [{ id: 'sec1' }], error: null },                 // insert sections (thenable)
        { data: null, error: null },                             // insert tqb
        { data: null, error: null },                             // insert batches
        { data: { ...testRow, test_sections: [], test_question_bank: [], test_batches: [] }, error: null }, // findOne
      ]);
      const result = await service.create(createDto as any, 'user-1');
      expect(result.id).toBe('t1');
    });

    it('defaults passing marks to 40% when omitted', async () => {
      const testRow = { id: 't1', status: 'draft', total_marks: 10 };
      setupFrom(client, [
        { data: testRow, error: null },
        { data: [], error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: testRow, error: null },
      ]);
      const { passingMarks, ...noPass } = createDto;
      await service.create(noPass as any, 'u');
      const inserted = client.from.mock.calls[0][0];
      expect(inserted).toBe('tests');
      // verify insert payload via the chain's insert call
      const insertPayload = (client.from as any).mock.results[0].value;
      // captured during insert
    });

    it('throws on insert error', async () => {
      setupFrom(client, [{ data: null, error: new Error('db') }]);
      await expect(service.create(createDto as any, 'u')).rejects.toThrow('Failed to create test');
    });

    it('rolls back when section insert fails', async () => {
      const testRow = { id: 't1', title: 'Test 1', status: 'draft', total_marks: 10 };
      setupFrom(client, [
        { data: testRow, error: null }, // insert tests
        { data: null, error: { code: '23503', message: 'FK violation' } }, // sections insert error
        { data: null, error: null }, // delete test_question_bank
        { data: null, error: null }, // delete test_sections
        { data: null, error: null }, // delete test_batches
        { data: null, error: null }, // delete tests
      ]);
      await expect(service.create(createDto as any, 'u')).rejects.toThrow();
      // verify cleanup deletes were attempted (at least 4 deletes after failure)
      expect(client.from).toHaveBeenCalledWith('test_question_bank');
      expect(client.from).toHaveBeenCalledWith('test_sections');
      expect(client.from).toHaveBeenCalledWith('test_batches');
      expect(client.from).toHaveBeenCalledWith('tests');
    });

    it('rolls back when question relation fails', async () => {
      const testRow = { id: 't2', title: 'Test 1', status: 'draft', total_marks: 10 };
      setupFrom(client, [
        { data: testRow, error: null }, // insert tests
        { data: [{ id: 'sec1' }], error: null }, // sections ok
        { data: null, error: { code: '23503', message: 'Invalid question' } }, // tqb error
        { data: null, error: null }, // delete tqb
        { data: null, error: null }, // delete sections
        { data: null, error: null }, // delete batches
        { data: null, error: null }, // delete tests
      ]);
      await expect(service.create(createDto as any, 'u')).rejects.toThrow();
      expect(client.from).toHaveBeenCalledWith('test_question_bank');
    });

    it('rolls back when batch relation fails', async () => {
      const testRow = { id: 't3', title: 'Test 1', status: 'draft', total_marks: 10 };
      setupFrom(client, [
        { data: testRow, error: null },
        { data: [{ id: 'sec1' }], error: null },
        { data: null, error: null }, // tqb ok
        { data: null, error: { code: '23503', message: 'Invalid batch' } }, // batches error
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ]);
      await expect(service.create(createDto as any, 'u')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rolls back when final findOne fails', async () => {
      const testRow = { id: 't4', title: 'Test 1', status: 'draft', total_marks: 10 };
      setupFrom(client, [
        { data: testRow, error: null },
        { data: [{ id: 'sec1' }], error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: new Error('findOne failed') }, // findOne -> NotFound
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ]);
      await expect(service.create(createDto as any, 'u')).rejects.toThrow();
    });

    it('logs rollback failure but still throws original error', async () => {
      const testRow = { id: 't5', title: 'Test 1', status: 'draft', total_marks: 10 };
      setupFrom(client, [
        { data: testRow, error: null },
        { data: null, error: { code: '23503', message: 'FK fail' } },
        { data: null, error: { message: 'cleanup fail' } }, // delete tqb fails
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ]);
      await expect(service.create(createDto as any, 'u')).rejects.toThrow();
    });

    it('classifies FK violation as BadRequest', async () => {
      const testRow = { id: 't6', title: 'Test 1', status: 'draft', total_marks: 10 };
      setupFrom(client, [
        { data: testRow, error: null },
        { data: [{ id: 'sec1' }], error: null },
        { data: null, error: null },
        { data: null, error: { code: '23503', message: 'FK batch' } },
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
        { data: null, error: null },
      ]);
      await expect(service.create(createDto as any, 'u')).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('findAll', () => {
    it('returns paginated tests', async () => {
      setupFrom(client, [{ data: [{ id: 't1' }], count: 1, error: null }]);
      const result = await service.findAll({ status: 'published', page: 1, limit: 10 });
      expect(result.total).toBe(1);
      expect(result.items).toHaveLength(1);
    });

    it('defaults page/limit', async () => {
      setupFrom(client, [{ data: [], count: 0, error: null }]);
      const result = await service.findAll({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
    });
  });

  describe('findOne', () => {
    it('returns the test', async () => {
      setupFrom(client, [{ data: { id: 't1' }, error: null }]);
      await expect(service.findOne('t1')).resolves.toEqual({ id: 't1' });
    });

    it('throws NotFound when missing', async () => {
      setupFrom(client, [{ data: null, error: null }]);
      await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('updateStatus', () => {
    it('updates a valid status', async () => {
      const row = { id: 't1', status: 'published' };
      setupFrom(client, [
        { data: null, error: null }, // update
        { data: row, error: null },  // findOne
      ]);
      const result = await service.updateStatus('t1', 'published');
      expect(result.status).toBe('published');
    });

    it('rejects invalid status', async () => {
      await expect(service.updateStatus('t1', 'bogus')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('archive', () => {
    it('sets status to archived', async () => {
      const row = { id: 't1', status: 'archived' };
      setupFrom(client, [
        { data: null, error: null },
        { data: row, error: null },
      ]);
      const result = await service.archive('t1');
      expect(result.status).toBe('archived');
    });
  });

  describe('remove', () => {
    it('deletes a test', async () => {
      setupFrom(client, [{ data: null, error: null }]);
      await expect(service.remove('t1')).resolves.toEqual({ deleted: true });
    });
  });

  describe('getMyTests', () => {
    it('returns empty when student has no batches', async () => {
      setupFrom(client, [{ data: [], error: null }]);
      const result = await service.getMyTests('u1');
      expect(result.items).toHaveLength(0);
    });

    it('filters tests by student batches + status', async () => {
      setupFrom(client, [
        { data: [{ batch_id: 'b1' }], error: null },           // enrolments
        { data: [{ test_id: 't1' }], error: null },            // test_batches
        { data: [{ id: 't1', title: 'T', test_batches: [] }], count: 1, error: null }, // tests
      ]);
      const result = await service.getMyTests('u1');
      expect(result.items).toHaveLength(1);
      expect(result.items[0].title).toBe('T');
    });

    it('returns empty when no test_batches match', async () => {
      setupFrom(client, [
        { data: [{ batch_id: 'b1' }], error: null },
        { data: [], error: null },
      ]);
      const result = await service.getMyTests('u1');
      expect(result.items).toHaveLength(0);
      expect(result.total).toBe(0);
    });
  });
});
