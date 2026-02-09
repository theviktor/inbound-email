const fs = require('fs').promises;
const path = require('path');
const DurableQueue = require('../../services/durableQueue');

describe('durableQueue', () => {
  const queuePath = path.join(__dirname, '..', 'tmp-durable-queue');
  let queue;

  beforeEach(async () => {
    await fs.rm(queuePath, { recursive: true, force: true });
    queue = new DurableQueue(queuePath);
    await queue.ensureInitialized();
  });

  afterEach(async () => {
    await fs.rm(queuePath, { recursive: true, force: true });
  });

  it('creates, reads, lists, updates and removes tasks', async () => {
    const id = await queue.create({ parsed: { subject: 'test' }, failedWebhooks: null });
    expect(id).toBeDefined();

    const listed = await queue.listIds();
    expect(listed).toContain(id);

    const task = await queue.get(id);
    expect(task.parsed.subject).toBe('test');

    await queue.update(id, { failedWebhooks: ['https://example.com/webhook'] });
    const updated = await queue.get(id);
    expect(updated.failedWebhooks).toEqual(['https://example.com/webhook']);

    await queue.remove(id);
    const listedAfterRemove = await queue.listIds();
    expect(listedAfterRemove).toHaveLength(0);
  });
});
