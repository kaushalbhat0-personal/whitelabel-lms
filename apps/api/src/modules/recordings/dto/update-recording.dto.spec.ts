/*
 * Phase 7E state-machine guard: the admin status-update DTO must only ever
 * accept statuses the live recordings CHECK constraint allows
 * (processing | ready | failed). 'error' caused a PGRST CHECK violation and a
 * stuck 'processing' row in the 7B incident class.
 */
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateRecordingDto } from './update-recording.dto';

describe('UpdateRecordingDto — canonical status vocabulary', () => {
  async function validateStatus(status: unknown): Promise<string[]> {
    const dto = plainToInstance(UpdateRecordingDto, { status });
    const errors = await validate(dto, { skipMissingProperties: true });
    return errors.find((e) => e.property === 'status')?.constraints
      ? Object.values(errors.find((e) => e.property === 'status')!.constraints!)
      : [];
  }

  it.each(['processing', 'ready', 'failed'])(
    'accepts canonical status "%s"',
    async (status) => {
      expect(await validateStatus(status)).toEqual([]);
    },
  );

  it.each(['error', 'errored', 'READY', '', null, undefined, 42])(
    'rejects non-canonical status %p',
    async (status) => {
      const violations = await validateStatus(status);
      if (status === undefined || status === null) {
        // optional field: absent/null must not itself be a violation of IsIn
        // (class-validator skips null/undefined for @IsIn when @IsOptional).
        expect(violations).toEqual([]);
      } else {
        expect(violations.length).toBeGreaterThan(0);
      }
    },
  );
});
