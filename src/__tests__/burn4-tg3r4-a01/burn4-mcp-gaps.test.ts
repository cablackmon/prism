import { createHarness } from './burn4-mcp-harness';
import { consumerReply, driftCases, fixtureMeals, mealRangeReply, methodCases, patchConsumerReply, quantityCases, quantityContract } from './burn4-mcp-consumer-contract';

test.each(driftCases)('$name consumer fixture accepts the documented required-field control', ({ path, validConsumer }) => {
  const response = consumerReply({ url: `https://offline.invalid${path}`, method: 'POST', body: JSON.stringify(validConsumer) });
  expect(response.ok).toBe(true);
  expect(response.status).toBe(201);
});

test.each(driftCases)('$name cannot forward required consumer fields even when supplied by caller', async ({ name, path, args, missing }) => {
  const h = createHarness({ fetchReply: consumerReply });
  await expect(h.call(name, args)).rejects.toThrow(`Prism API POST ${path} → 400: {"error":"Validation failed","fields":${JSON.stringify(missing)}}`);
  const sent = JSON.parse(h.requests[0]!.body!);
  for (const field of missing) expect(sent).not.toHaveProperty(field);
});

test.failing.each(driftCases)('KNOWN GAP: $name $defect', async ({ name, args }) => {
  const h = createHarness({ fetchReply: consumerReply });
  // A correct MCP mapping should satisfy the required consumer contract.
  await expect(h.call(name, args)).resolves.toMatchObject({ structuredContent: { accepted: true } });
});


test.each(methodCases)('$name consumer accepts PATCH but rejects current PUT mapping', async ({ name, path, args }) => {
  expect(patchConsumerReply({ url: `https://offline.invalid${path}`, method: 'PATCH', body: '{}' }).status).toBe(200);
  const h = createHarness({ fetchReply: patchConsumerReply });
  await expect(h.call(name, args)).rejects.toThrow(`Prism API PUT ${path} → 405: {"error":"Method Not Allowed"}`);
});

test.failing.each(methodCases)('KNOWN GAP: $name uses PUT for a PATCH-only consumer route', async ({ name, args }) => {
  const h = createHarness({ fetchReply: patchConsumerReply });
  await expect(h.call(name, args)).resolves.toMatchObject({ structuredContent: { accepted: true } });
});

test.each(quantityCases)('$name consumer quantity accepts positive integers and rejects strings', async ({ name, args }) => {
  expect(quantityContract.safeParse({ quantity: 2 }).success).toBe(true);
  expect(quantityContract.safeParse({ quantity: '2' }).success).toBe(false);
  const h = createHarness();
  await h.ready;
  expect(h.schema(name).safeParse(args).success).toBe(false);
  expect(h.requests).toHaveLength(0);
});

test.failing.each(quantityCases)('KNOWN GAP: $name rejects the consumer positive-integer quantity type', async ({ name, args }) => {
  const h = createHarness();
  await h.ready;
  expect(h.schema(name).safeParse(args).success).toBe(true);
});

test('meal range consumer control uses inclusive from/to and otherwise returns all entries', async () => {
  const ranged = mealRangeReply({ url: 'https://offline.invalid/api/meals?from=2026-10-21&to=2026-10-22', method: 'GET' });
  expect(JSON.parse(await ranged.text())).toEqual({ meals: fixtureMeals.slice(1, 3) });
  const all = mealRangeReply({ url: 'https://offline.invalid/api/meals', method: 'GET' });
  expect(JSON.parse(await all.text())).toEqual({ meals: fixtureMeals });
});

test.failing('KNOWN GAP: list_meals sends startDate/endDate instead of consumer from/to and returns outside-range entries', async () => {
  const h = createHarness({ fetchReply: mealRangeReply });
  const result = await h.call('list_meals', { startDate: '2026-10-21', endDate: '2026-10-22' });
  expect(result.structuredContent).toEqual({ meals: fixtureMeals.slice(1, 3) });
});
