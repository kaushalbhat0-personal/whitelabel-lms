import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { SupabaseService } from '../../common/services/supabase.service';
import { TABLES } from '../../common/constants/tables.constant';
import { ilikeContains } from '../../common/utils/like-escape.util';
import { CreateQuestionDto, UpdateQuestionDto } from './dto/create-question.dto';

const QUESTION_SELECT = `
  *,
  topics(name)
`;

@Injectable()
export class QuestionsService {
  private readonly logger = new Logger(QuestionsService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async create(dto: CreateQuestionDto, userId: string) {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.QUESTION_BANK)
      .insert({
        question_text: dto.questionText,
        question_type: dto.questionType,
        options: dto.options ?? null,
        correct_answer: dto.correctAnswer ?? null,
        explanation: dto.explanation ?? null,
        difficulty: dto.difficulty ?? 'medium',
        topic_id: dto.topicId ?? null,
        image_url: dto.imageUrl ?? null,
        created_by: userId,
        is_archived: false,
      })
      .select(QUESTION_SELECT)
      .single();

    if (error) throw error;
    return data;
  }

  async findAll(options?: {
    topicId?: string;
    difficulty?: string;
    questionType?: string;
    search?: string;
    page?: number;
    limit?: number;
  }) {
    let query = this.supabaseService.client
      .from(TABLES.QUESTION_BANK)
      .select(QUESTION_SELECT, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (options?.topicId) query = query.eq('topic_id', options.topicId);
    if (options?.difficulty) query = query.eq('difficulty', options.difficulty);
    if (options?.questionType) query = query.eq('question_type', options.questionType);
    if (options?.search) query = query.ilike('question_text', ilikeContains(options.search));

    const page = options?.page ?? 1;
    const limit = options?.limit ?? 50;
    const from = (page - 1) * limit;
    const to = from + limit - 1;
    query = query.range(from, to);

    const { data, count, error } = await query;
    if (error) throw error;

    return { items: data ?? [], total: count ?? 0, page, limit };
  }

  async findOne(id: string) {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.QUESTION_BANK)
      .select(QUESTION_SELECT)
      .eq('id', id)
      .single();

    if (error || !data) throw new NotFoundException('Question not found');
    return data;
  }

  async update(id: string, dto: UpdateQuestionDto) {
    const existing = await this.findOne(id);
    if (!existing) throw new NotFoundException('Question not found');

    const updates: Record<string, any> = {};
    if (dto.questionText !== undefined) updates.question_text = dto.questionText;
    if (dto.questionType !== undefined) updates.question_type = dto.questionType;
    if (dto.options !== undefined) updates.options = dto.options;
    if (dto.correctAnswer !== undefined) updates.correct_answer = dto.correctAnswer;
    if (dto.explanation !== undefined) updates.explanation = dto.explanation;
    if (dto.difficulty !== undefined) updates.difficulty = dto.difficulty;
    if (dto.topicId !== undefined) updates.topic_id = dto.topicId;
    if (dto.imageUrl !== undefined) updates.image_url = dto.imageUrl;
    if (dto.isArchived !== undefined) updates.is_archived = dto.isArchived;
    updates.updated_at = new Date().toISOString();

    const { error } = await this.supabaseService.client
      .from(TABLES.QUESTION_BANK)
      .update(updates)
      .eq('id', id);

    if (error) throw error;
    return this.findOne(id);
  }

  async archive(id: string) {
    const { error } = await this.supabaseService.client
      .from(TABLES.QUESTION_BANK)
      .update({ is_archived: true, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
    return this.findOne(id);
  }

  async unarchive(id: string) {
    const { error } = await this.supabaseService.client
      .from(TABLES.QUESTION_BANK)
      .update({ is_archived: false, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) throw error;
    return this.findOne(id);
  }

  async remove(id: string) {
    const { error } = await this.supabaseService.client
      .from(TABLES.QUESTION_BANK)
      .delete()
      .eq('id', id);

    if (error) throw error;
    return { deleted: true };
  }

  async bulkImport(dto: { questions: CreateQuestionDto[] }, userId: string) {
    const results = [];
    for (const questionDto of dto.questions) {
      const result = await this.create(questionDto, userId);
      results.push(result);
    }
    return { imported: results.length, questions: results };
  }

  async getTopics() {
    const { data, error } = await this.supabaseService.client
      .from(TABLES.TOPICS)
      .select('*')
      .order('sort_order', { ascending: true });

    if (error) throw error;
    return data ?? [];
  }
}
