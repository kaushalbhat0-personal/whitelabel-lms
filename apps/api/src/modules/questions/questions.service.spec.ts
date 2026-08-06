import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { QuestionsService } from './questions.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';

function mockSupabase() {
  const chain: any = {
    select: jest.fn().mockReturnThis(),
    eq: jest.fn().mockReturnThis(),
    in: jest.fn().mockReturnThis(),
    order: jest.fn().mockReturnThis(),
    range: jest.fn().mockReturnThis(),
    single: jest.fn(),
    maybeSingle: jest.fn(),
    insert: jest.fn().mockReturnThis(),
    update: jest.fn().mockReturnThis(),
    delete: jest.fn().mockReturnThis(),
    ilike: jest.fn().mockReturnThis(),
  };
  chain.single.mockResolvedValue({ data: null, error: null });
  chain.maybeSingle.mockResolvedValue({ data: null, error: null });
  return {
    chain,
    client: { from: jest.fn(() => chain) },
  };
}

const dto = {
  questionText: 'What is 2+2?',
  questionType: 'single_choice',
  options: { options: ['3', '4', '5'] },
  correctAnswer: '4',
  explanation: '2+2=4',
  difficulty: 'easy',
  topicId: 'topic-1',
  imageUrl: undefined,
} as any;

describe('QuestionsService', () => {
  let service: QuestionsService;
  let sb: ReturnType<typeof mockSupabase>;
  let chain: any;

  beforeEach(async () => {
    sb = mockSupabase();
    chain = sb.chain;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        QuestionsService,
        { provide: SupabaseService, useValue: { client: sb.client } },
      ],
    }).compile();
    service = module.get(QuestionsService);
  });

  describe('create', () => {
    it('inserts a question with defaults', async () => {
      const row = { id: 'q1', ...dto, difficulty: 'easy', is_archived: false };
      chain.single.mockResolvedValue({ data: row, error: null });
      const result = await service.create(dto, 'user-1');
      expect(chain.insert).toHaveBeenCalledWith({
        question_text: dto.questionText,
        question_type: dto.questionType,
        options: dto.options,
        correct_answer: dto.correctAnswer,
        explanation: dto.explanation,
        difficulty: 'easy',
        topic_id: dto.topicId,
        image_url: null,
        created_by: 'user-1',
        is_archived: false,
      });
      expect(result.id).toBe('q1');
    });

    it('defaults difficulty to medium when omitted', async () => {
      const row = { id: 'q2' };
      chain.single.mockResolvedValue({ data: row, error: null });
      const { difficulty, ...noDiff } = dto;
      await service.create({ ...noDiff, difficulty: undefined as any }, 'u');
      const inserted = chain.insert.mock.calls[0][0];
      expect(inserted.difficulty).toBe('medium');
    });

    it('throws on DB error', async () => {
      chain.single.mockResolvedValue({ data: null, error: new Error('boom') });
      await expect(service.create(dto, 'u')).rejects.toThrow('boom');
    });
  });

  describe('findAll', () => {
    it('applies filters and pagination', async () => {
      const items = [{ id: 'q1' }, { id: 'q2' }];
      chain.select.mockReturnValue(chain);
      chain.order.mockReturnValue(chain);
      chain.range.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      chain.ilike.mockReturnValue(chain);
      // resolve select query
      chain.range.mockResolvedValue({ data: items, count: 2, error: null });
      const result = await service.findAll({ topicId: 't', difficulty: 'easy', questionType: 'single_choice', search: 'What', page: 2, limit: 10 });
      expect(result.items).toHaveLength(2);
      expect(result.total).toBe(2);
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
      expect(chain.eq).toHaveBeenCalled();
      expect(chain.ilike).toHaveBeenCalledWith('question_text', '%What%');
    });

    it('defaults page/limit', async () => {
      chain.order.mockReturnValue(chain);
      chain.range.mockResolvedValue({ data: [], count: 0, error: null });
      const result = await service.findAll({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(50);
    });
  });

  describe('findOne', () => {
    it('returns the question', async () => {
      chain.single.mockResolvedValue({ data: { id: 'q1' }, error: null });
      await expect(service.findOne('q1')).resolves.toEqual({ id: 'q1' });
    });

    it('throws NotFoundException when missing', async () => {
      chain.single.mockResolvedValue({ data: null, error: null });
      await expect(service.findOne('nope')).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('update', () => {
    it('updates only provided fields', async () => {
      chain.single
        .mockResolvedValueOnce({ data: { id: 'q1' }, error: null }) // existing
        .mockResolvedValueOnce({ data: { id: 'q1', question_text: 'new' }, error: null }); // re-fetch
      chain.update.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      const result = await service.update('q1', { questionText: 'new' });
      expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ question_text: 'new' }));
      expect(result.question_text).toBe('new');
    });

    it('throws NotFound when question missing', async () => {
      chain.single.mockResolvedValueOnce({ data: null, error: null });
      await expect(service.update('nope', { questionText: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('archive/unarchive', () => {
    it('archives a question', async () => {
      chain.update.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      chain.single.mockResolvedValueOnce({ data: { id: 'q1', is_archived: true }, error: null });
      const result = await service.archive('q1');
      expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ is_archived: true }));
      expect(result.is_archived).toBe(true);
    });

    it('unarchives a question', async () => {
      chain.update.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      chain.single.mockResolvedValueOnce({ data: { id: 'q1', is_archived: false }, error: null });
      const result = await service.unarchive('q1');
      expect(chain.update).toHaveBeenCalledWith(expect.objectContaining({ is_archived: false }));
      expect(result.is_archived).toBe(false);
    });
  });

  describe('remove', () => {
    it('deletes a question', async () => {
      chain.delete.mockReturnValue(chain);
      chain.eq.mockReturnValue(chain);
      const result = await service.remove('q1');
      expect(result).toEqual({ deleted: true });
      expect(chain.delete).toHaveBeenCalled();
    });

    it('throws on DB error', async () => {
      chain.delete.mockReturnValue(chain);
      chain.eq.mockResolvedValue({ data: null, error: new Error('fk violation') });
      await expect(service.remove('q1')).rejects.toThrow('fk violation');
    });
  });

  describe('bulkImport', () => {
    it('imports multiple questions sequentially', async () => {
      chain.single.mockResolvedValue({ data: { id: 'new' }, error: null });
      const result = await service.bulkImport({ questions: [dto, dto] }, 'u');
      expect(result.imported).toBe(2);
      expect(result.questions).toHaveLength(2);
      expect(chain.insert).toHaveBeenCalledTimes(2);
    });
  });

  describe('getTopics', () => {
    it('returns ordered topics', async () => {
      chain.order.mockResolvedValue({ data: [{ id: 't1', name: 'A' }], error: null });
      const result = await service.getTopics();
      expect(result).toHaveLength(1);
      expect(chain.order).toHaveBeenCalledWith('sort_order', { ascending: true });
    });
  });
});
