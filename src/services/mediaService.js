const Media = require('../models/Media');
const { enqueue } = require('./queue');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function withRetry(fn, maxRetries = 5) {
  let retries = 0;
  while (retries < maxRetries) {
    try {
      return await fn();
    } catch (err) {
      if (err.response && err.response.error_code === 429 && err.response.parameters && err.response.parameters.retry_after) {
        const retryAfter = err.response.parameters.retry_after * 1000;
        console.log(`[withRetry] Got 429, waiting ${retryAfter}ms...`);
        await sleep(retryAfter);
        retries++;
      } else {
        throw err;
      }
    }
  }
  throw new Error(`Max retries (${maxRetries}) exceeded`);
}

/**
 * Delivers up to `count` media items to `chatId`.
 * Pass `excludeIds` to skip items the user has already received.
 * Returns the array of delivered Media documents so the caller can
 * deduct exactly `items.length * pricePerItem` and update history.
 */
async function deliverMedia(telegram, chatId, count, { excludeIds = [] } = {}) {
  const delivered = [];
  const usedIds = new Set(excludeIds.map((id) => id.toString()));

  while (delivered.length < count) {
    const filter = { _id: { $nin: Array.from(usedIds) } };
    const available = await Media.countDocuments(filter);

    if (available === 0) break;

    const needed = count - delivered.length;
    const sampleSize = Math.min(needed * 5, available);
    const pipeline = [
      { $match: filter },
      { $sample: { size: sampleSize } },
    ];
    const candidates = await Media.aggregate(pipeline);

    if (!candidates.length) break;

    for (const item of candidates) {
      const itemId = item._id.toString();
      if (usedIds.has(itemId)) continue;

      try {
        await enqueue(async () => {
          await withRetry(async () => {
            if (item.fileType === 'photo') {
              await telegram.sendPhoto(chatId, item.fileId);
            } else {
              await telegram.sendVideo(chatId, item.fileId);
            }
          });
        });

        delivered.push(item);
        usedIds.add(itemId);

        if (delivered.length === count) break;
      } catch (err) {
        console.error('[deliverMedia] failed to send item', itemId, err.message);
      }
    }
  }

  return delivered;
}

module.exports = { deliverMedia, withRetry };
