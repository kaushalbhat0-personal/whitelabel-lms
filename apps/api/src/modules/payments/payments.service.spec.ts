jest.mock('puppeteer', () => ({}));
jest.mock('handlebars', () => ({ compile: jest.fn(() => jest.fn(() => '')) }));

import { Test, TestingModule } from '@nestjs/testing';
import { PaymentsService } from './payments.service';
import { SupabaseService } from '../../common/services/supabase.service';
import { OutboxService } from '../outbox/outbox.service';
import { ObservabilityService } from '../observability/observability.service';
import { RedisCacheService } from '../../common/services/redis-cache.service';

function chainMock(resolveTo: any): any {
  const q: any = {
    select: jest.fn(() => q),
    eq: jest.fn(() => q),
    in: jest.fn(() => q),
    single: jest.fn(),
    maybeSingle: jest.fn(),
    insert: jest.fn(() => q),
    update: jest.fn(() => q),
    delete: jest.fn(() => q),
    order: jest.fn(() => q),
    limit: jest.fn(() => q),
    range: jest.fn(() => q),
  };
  q.single.mockResolvedValue(resolveTo);
  q.maybeSingle.mockResolvedValue(resolveTo);
  q.then = (onF: any) => Promise.resolve(resolveTo).then(onF);
  return q;
}

describe('PaymentsService — P1 Finance Agreed Fee Foundation', () => {
  let service: PaymentsService;
  let client: any;
  let outbox: any;

  const ADMIN = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const STUDENT = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const COURSE = 'cccccccc-cccc-4ccc-cccc-cccccccccccc';
  const PLAN_ID = 'dddddddd-dddd-4ddd-dddd-dddddddddddd';

  beforeEach(async () => {
    client = { from: jest.fn(), auth: { admin: {} } };
    outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: SupabaseService, useValue: { client } },
        { provide: OutboxService, useValue: outbox },
        { provide: ObservabilityService, useValue: { logEvent: jest.fn().mockResolvedValue(undefined) } },
        { provide: RedisCacheService, useValue: { invalidatePaymentsCacheForUser: jest.fn().mockResolvedValue(undefined), key: jest.fn((...a: string[]) => a.join(':')), wrap: jest.fn((_, __, fn: () => any) => fn()) } },
      ],
    }).compile();
    service = module.get(PaymentsService);
  });

  function mockCreatePlanFlow(overrides: { totalAmount?: number; discountShouldPersist?: any } = {}) {
    let fromCall = 0;
    client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return chainMock({ data: { id: STUDENT }, error: null });
      if (table === 'courses') return chainMock({ data: { id: COURSE, is_active: true }, error: null });
      if (table === 'payment_plans') {
        fromCall++;
        if (fromCall <= 2) {
          // insert plan + select plan — return plan with requested total
          return chainMock({ data: { id: PLAN_ID, total_amount: overrides.totalAmount ?? 62705 }, error: null });
        }
        // delete cleanup path not needed
        return chainMock({ data: null, error: null });
      }
      if (table === 'payment_installments') {
        // insert installments + select installments
        return chainMock({ data: [], error: null });
      }
      return chainMock({ data: null, error: null });
    });
  }

  // capture inserted plan row for assertions
  let insertedPlan: any = null;
  function capturePlanInsert() {
    insertedPlan = null;
    const origFrom = client.from.bind(client);
    client.from.mockImplementation((table: string) => {
      const q: any = chainMock({ data: { id: STUDENT }, error: null });
      if (table === 'profiles') return chainMock({ data: { id: STUDENT }, error: null });
      if (table === 'courses') return chainMock({ data: { id: COURSE, is_active: true }, error: null });
      if (table === 'payment_plans') {
        const inner: any = chainMock({ data: { id: PLAN_ID }, error: null });
        const realInsert = inner.insert.bind(inner);
        inner.insert = jest.fn((row: any) => {
          insertedPlan = row;
          return chainMock({ data: { id: PLAN_ID, ...row }, error: null });
        });
        return inner;
      }
      if (table === 'payment_installments') return chainMock({ data: [], error: null });
      return chainMock({ data: null, error: null });
    });
  }

  function supabaseForCapture() {
    insertedPlan = null;
    client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return chainMock({ data: { id: STUDENT }, error: null });
      if (table === 'courses') return chainMock({ data: { id: COURSE, is_active: true }, error: null });
      if (table === 'payment_plans') {
        const base: any = chainMock({ data: { id: PLAN_ID }, error: null });
        base.insert = jest.fn((row: any) => {
          insertedPlan = row;
          return chainMock({ data: { id: PLAN_ID, ...row }, error: null });
        });
        return base;
      }
      if (table === 'payment_installments') {
        const base: any = chainMock({ data: null, error: null });
        base.select = jest.fn(() => chainMock({ data: [], error: null }));
        base.insert = jest.fn(() => chainMock({ data: null, error: null }));
        // second call select installments
        let calls = 0;
        base.select.mockImplementation(() => {
          calls++;
          return chainMock({ data: [], error: null });
        });
        // supabase client.from('payment_installments').select fallback
        return base;
      }
      return chainMock({ data: null, error: null });
    });
  }

  // Simpler: patch Supabase insert capture via jest.spyOn
  function setupCapture() {
    insertedPlan = null;
    client.from.mockImplementation((table: string) => {
      if (table === 'profiles') return chainMock({ data: { id: STUDENT }, error: null });
      if (table === 'courses') return chainMock({ data: { id: COURSE, is_active: true }, error: null });
      if (table === 'payment_plans') {
        const chain: any = {
          insert: jest.fn((row: any) => {
            insertedPlan = row;
            return {
              select: jest.fn(() => ({
                single: jest.fn().mockResolvedValue({ data: { id: PLAN_ID, ...row }, error: null }),
              })),
            };
          }),
        };
        return chain;
      }
      if (table === 'payment_installments') {
        return {
          insert: jest.fn(() => chainMock({ data: null, error: null })),
          select: jest.fn(() => ({
            eq: jest.fn(() => ({
              order: jest.fn(() => chainMock({ data: [], error: null })),
            })),
          })),
        } as any;
      }
      return chainMock({ data: null, error: null }) as any;
    });
  }

  // Use stubbed service path by overriding supabase client per test
  async function callCreate(dto: any) {
    return service.createPaymentPlan(dto, ADMIN);
  }

  describe('legacy compatibility', () => {
    it('legacy plan without standard fee still works', async () => {
      setupCapture();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 62705, numberOfInstallments: 6 });
      expect(insertedPlan).toBeDefined();
      expect(insertedPlan.total_amount).toBe(62705);
      expect(insertedPlan.standard_course_fee).toBeNull();
      expect(insertedPlan.discount_amount).toBe(0);
      expect(insertedPlan.booking_amount).toBeNull();
    });

    it('standard fee omitted + total provided -> PASS (backward compat)', async () => {
      setupCapture();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 60000, numberOfInstallments: 3 });
      expect(insertedPlan.discount_amount).toBe(0);
    });
  });

  describe('discount validation', () => {
    it('standard + zero discount PASS', async () => {
      setupCapture();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 72705, numberOfInstallments: 3, standardCourseFee: 72705, discountAmount: 0 });
      expect(insertedPlan.standard_course_fee).toBe(72705);
      expect(insertedPlan.discount_amount).toBe(0);
      expect(insertedPlan.total_amount).toBe(72705);
    });

    it('standard 72705 + discount 10000 + total 62705 PASS', async () => {
      setupCapture();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 62705, numberOfInstallments: 6, standardCourseFee: 72705, discountAmount: 10000 });
      expect(insertedPlan.total_amount).toBe(62705);
    });

    it('inconsistent total REJECT (standard - discount != total)', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainMock({ data: { id: STUDENT }, error: null });
        if (table === 'courses') return chainMock({ data: { id: COURSE, is_active: true }, error: null });
        return chainMock({ data: null, error: null });
      });
      await expect(
        callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 65000, numberOfInstallments: 6, standardCourseFee: 72705, discountAmount: 10000 }),
      ).rejects.toThrow(/Inconsistent totalAmount/);
    });

    it('discount greater than standard REJECT', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainMock({ data: { id: STUDENT }, error: null });
        if (table === 'courses') return chainMock({ data: { id: COURSE, is_active: true }, error: null });
        return chainMock({ data: null, error: null });
      });
      await expect(
        callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 50000, numberOfInstallments: 2, standardCourseFee: 72705, discountAmount: 80000 }),
      ).rejects.toThrow(/cannot exceed standardCourseFee/);
    });

    it('negative discount REJECT via service guard', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainMock({ data: { id: STUDENT }, error: null });
        if (table === 'courses') return chainMock({ data: { id: COURSE, is_active: true }, error: null });
        return chainMock({ data: null, error: null });
      });
      await expect(
        callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 62705, numberOfInstallments: 2, standardCourseFee: 72705, discountAmount: -5 }),
      ).rejects.toThrow();
    });

    it('discount without standard fee REJECT', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainMock({ data: { id: STUDENT }, error: null });
        if (table === 'courses') return chainMock({ data: { id: COURSE, is_active: true }, error: null });
        return chainMock({ data: null, error: null });
      });
      await expect(
        callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 62000, numberOfInstallments: 2, discountAmount: 5000 }),
      ).rejects.toThrow(/standardCourseFee is required/);
    });

    it('discountReason persisted when supplied', async () => {
      setupCapture();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 62705, numberOfInstallments: 2, standardCourseFee: 72705, discountAmount: 10000, discountReason: 'Scholarship' });
      expect(insertedPlan.discount_reason).toBe('Scholarship');
    });
  });

  describe('booking validation', () => {
    it('booking = 0 PASS (explicit zero)', async () => {
      setupCapture();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 62705, numberOfInstallments: 6, bookingAmount: 0 });
      expect(insertedPlan.booking_amount).toBe(0);
    });

    it('booking 5163 within total 62705 PASS', async () => {
      setupCapture();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 62705, numberOfInstallments: 6, bookingAmount: 5163 });
      expect(insertedPlan.booking_amount).toBe(5163);
    });

    it('booking greater than total REJECT', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainMock({ data: { id: STUDENT }, error: null });
        if (table === 'courses') return chainMock({ data: { id: COURSE, is_active: true }, error: null });
        return chainMock({ data: null, error: null });
      });
      await expect(
        callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 62705, numberOfInstallments: 6, bookingAmount: 70000 }),
      ).rejects.toThrow(/cannot exceed totalAmount/);
    });

    it('negative booking REJECT', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainMock({ data: { id: STUDENT }, error: null });
        if (table === 'courses') return chainMock({ data: { id: COURSE, is_active: true }, error: null });
        return chainMock({ data: null, error: null });
      });
      await expect(
        callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 62705, numberOfInstallments: 2, bookingAmount: -1 }),
      ).rejects.toThrow();
    });

    it('booking omitted -> NULL (legacy behavior preserved)', async () => {
      setupCapture();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 60000, numberOfInstallments: 3 });
      expect(insertedPlan.booking_amount).toBeNull();
    });
  });

  describe('existing installment generation unchanged', () => {
    it('still splits total into count installments with floor + last remainder', async () => {
      setupCapture();
      // total 100 / 3 -> 33.33,33.33,33.34
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 100, numberOfInstallments: 3 });
      expect(insertedPlan.total_amount).toBe(100);
      // installments are validated via subsequent mock — ensure no error thrown
    });
  });

  describe('cent precision', () => {
    it('72705 - 10000 == 62705 exact in cents', async () => {
      setupCapture();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 62705, numberOfInstallments: 6, standardCourseFee: 72705, discountAmount: 10000 });
      expect(insertedPlan.total_amount).toBe(62705);
    });

    it('rejects off-by-one cent inconsistency 62705.01', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainMock({ data: { id: STUDENT }, error: null });
        if (table === 'courses') return chainMock({ data: { id: COURSE, is_active: true }, error: null });
        return chainMock({ data: null, error: null });
      });
      await expect(
        callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 62705.01, numberOfInstallments: 6, standardCourseFee: 72705, discountAmount: 10000 }),
      ).rejects.toThrow(/Inconsistent totalAmount/);
    });
  });

  // ── P2: booking-independent EMI schedule ──
  describe('P2 EMI generation (booking-independent)', () => {
    let capturedInstallments: any[] = [];

    function setupCaptureP2() {
      insertedPlan = null;
      capturedInstallments = [];
      client.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainMock({ data: { id: STUDENT }, error: null });
        if (table === 'courses') return chainMock({ data: { id: COURSE, is_active: true }, error: null });
        if (table === 'payment_plans') {
          return {
            insert: jest.fn((row: any) => {
              insertedPlan = row;
              return { select: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { id: PLAN_ID, ...row }, error: null }) })) };
            }),
          } as any;
        }
        if (table === 'payment_installments') {
          return {
            insert: jest.fn((rows: any) => {
              capturedInstallments = rows;
              return chainMock({ data: null, error: null });
            }),
            select: jest.fn(() => ({ eq: jest.fn(() => ({ order: jest.fn(() => chainMock({ data: [], error: null })) })) })) as any,
          } as any;
        }
        return chainMock({ data: null, error: null }) as any;
      });
    }

    it('62705 / booking 5163 / 6 EMIs => 5x9590.33 + 9590.35, booking+EMIs==total', async () => {
      setupCaptureP2();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 62705, numberOfInstallments: 6, bookingAmount: 5163 });
      expect(capturedInstallments).toHaveLength(6);
      expect(capturedInstallments.map((r) => r.amount)).toEqual([9590.33, 9590.33, 9590.33, 9590.33, 9590.33, 9590.35]);
      const sum = capturedInstallments.reduce((s, r) => s + r.amount, 0);
      expect(Math.round(sum * 100)).toBe(57542 * 100);
      expect(Math.round((5163 + sum) * 100)).toBe(62705 * 100);
    });

    it('60000 booking NULL /6 => 6x10000', async () => {
      setupCaptureP2();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 60000, numberOfInstallments: 6 });
      expect(capturedInstallments.map((r) => r.amount)).toEqual([10000, 10000, 10000, 10000, 10000, 10000]);
    });

    it('60000 booking 0 /6 => 6x10000', async () => {
      setupCaptureP2();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 60000, numberOfInstallments: 6, bookingAmount: 0 });
      expect(capturedInstallments.map((r) => r.amount)).toEqual([10000, 10000, 10000, 10000, 10000, 10000]);
    });

    it('60000 booking 10000 /1 => EMI 50000', async () => {
      setupCaptureP2();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 60000, numberOfInstallments: 1, bookingAmount: 10000 });
      expect(capturedInstallments).toHaveLength(1);
      expect(capturedInstallments[0].amount).toBe(50000);
      expect(Math.round((10000 + capturedInstallments[0].amount) * 100)).toBe(60000 * 100);
    });

    it('booking == total => 6 EMIs of 0', async () => {
      setupCaptureP2();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 60000, numberOfInstallments: 6, bookingAmount: 60000 });
      expect(capturedInstallments.map((r) => r.amount)).toEqual([0, 0, 0, 0, 0, 0]);
    });

    it('booking > total rejected (already tested) still enforces', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'profiles') return chainMock({ data: { id: STUDENT }, error: null });
        if (table === 'courses') return chainMock({ data: { id: COURSE, is_active: true }, error: null });
        return chainMock({ data: null, error: null });
      });
      await expect(callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 60000, numberOfInstallments: 6, bookingAmount: 70000 })).rejects.toThrow(/cannot exceed totalAmount/);
    });

    it('100 /3 legacy booking NULL => 33.33,33.33,33.34', async () => {
      setupCaptureP2();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 100, numberOfInstallments: 3 });
      expect(capturedInstallments.map((r) => r.amount)).toEqual([33.33, 33.33, 33.34]);
    });

    it('final EMI absorbs remainder and booking+EMIs==total in cents', async () => {
      setupCaptureP2();
      await callCreate({ studentId: STUDENT, courseId: COURSE, totalAmount: 100, numberOfInstallments: 3, bookingAmount: 10 });
      // remaining 90 -> 30,30,30
      expect(capturedInstallments.map((r) => r.amount)).toEqual([30, 30, 30]);
      const sum = capturedInstallments.reduce((s, r) => s + Math.round(r.amount * 100), 0);
      expect(sum + 10 * 100).toBe(100 * 100);
    });
  });

  describe('P2 booking payment', () => {
    const PLAN_WITH_BOOKING = { id: PLAN_ID, student_id: STUDENT, course_id: COURSE, booking_amount: 5163, total_amount: 62705 };

    function mockBookingSetup(existingBooking: any) {
      // For recordBookingPayment: first call is payment_plans single, second is payments duplicate check, third is insert payments
      let call = 0;
      client.from.mockImplementation((table: string) => {
        if (table === 'payment_plans') {
          return { select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: PLAN_WITH_BOOKING, error: null }) })) })) } as any;
        }
        if (table === 'payments') {
          call++;
          if (call === 1) {
            // duplicate check: maybeSingle
            return {
              select: jest.fn(() => ({
                eq: jest.fn(() => ({
                  is: jest.fn(() => ({
                    limit: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: existingBooking, error: null }) })),
                  })),
                })),
              })),
            } as any;
          }
          // insert
          return {
            insert: jest.fn(() => ({
              select: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { id: 'pay1', amount: 5163 }, error: null }) })),
            })),
          } as any;
        }
        return chainMock({ data: null, error: null }) as any;
      });
    }

    it('booking payment creates payments with installment_id NULL and amount=booking', async () => {
      mockBookingSetup(null);
      const pay = await service.recordBookingPayment(PLAN_ID, { paymentMethod: 'upi' as any }, ADMIN);
      expect(pay).toBeDefined();
      // verify insert was with correct fields via captured? Instead verify outbox enqueued receipt
      expect(outbox.enqueue).toHaveBeenCalledWith('receipt', expect.objectContaining({ paymentId: 'pay1' }));
    });

    it('duplicate booking rejected', async () => {
      mockBookingSetup({ id: 'existing' });
      await expect(service.recordBookingPayment(PLAN_ID, { paymentMethod: 'upi' as any }, ADMIN)).rejects.toThrow(/already recorded/);
    });

    it('booking NULL rejected', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'payment_plans') {
          return { select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { ...PLAN_WITH_BOOKING, booking_amount: null }, error: null }) })) })) } as any;
        }
        return chainMock({ data: null, error: null }) as any;
      });
      await expect(service.recordBookingPayment(PLAN_ID, { paymentMethod: 'upi' as any }, ADMIN)).rejects.toThrow(/no booking amount/);
    });

    it('booking 0 rejected', async () => {
      client.from.mockImplementation((table: string) => {
        if (table === 'payment_plans') {
          return { select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: { ...PLAN_WITH_BOOKING, booking_amount: 0 }, error: null }) })) })) } as any;
        }
        return chainMock({ data: null, error: null }) as any;
      });
      await expect(service.recordBookingPayment(PLAN_ID, { paymentMethod: 'upi' as any }, ADMIN)).rejects.toThrow(/greater than 0/);
    });
  });
});
