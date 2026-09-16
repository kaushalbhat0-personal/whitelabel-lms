import { TestsService } from './tests.service';

function mockQuery(resolveTo: any) {
  const q: any = {
    select: jest.fn(() => q),
    eq: jest.fn(() => q),
    in: jest.fn(() => q),
    order: jest.fn(() => q),
    range: jest.fn(() => q),
    ilike: jest.fn(() => q),
    then: (onF: any) => Promise.resolve(resolveTo).then(onF),
  };
  q.single = jest.fn().mockResolvedValue(resolveTo);
  return q;
}

describe('TestsService P2-7 wildcard escaping', () => {
  it('escapes % and _ in ilike search', async () => {
    const client: any = { from: jest.fn() };
    const q = mockQuery({ data: [], count: 0, error: null });
    client.from.mockReturnValue(q);
    const svc = new TestsService(client as any, { } as any);
    // need to bypass findAll's SupabaseService shape: mock client.from returns chain with ilike
    // we replace supabaseService mock to capture ilike arg
    (svc as any).supabaseService = { client };
    await svc.findAll({ search: 'a%b_c', page: 1, limit: 10 });
    expect(q.ilike).toHaveBeenCalledWith('title', '%a\\%b\\_c%');
  });
  it('escapes mixed wildcards', async () => {
    const client: any = { from: jest.fn() };
    const q = mockQuery({ data: [], count: 0, error: null });
    client.from.mockReturnValue(q);
    const svc = new TestsService(client as any, {} as any);
    (svc as any).supabaseService = { client };
    await svc.findAll({ search: '%abc', page: 1, limit: 10 });
    expect(q.ilike).toHaveBeenCalledWith('title', '%\\%abc%');
  });
});
