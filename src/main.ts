import { Actor, log } from 'apify';
import { createHash } from 'node:crypto';

type Slice = 'posts' | 'post-watch' | 'similar' | 'locations';
type Input = {
    urls?: string[];
    urlsCsv?: string;
    fileUrl?: string;
    maxUrls?: number;
    concurrency?: number;
    resumeId?: string;
    freshStart?: boolean;
    watchId?: string;
    stateStoreName?: string;
    webhookUrl?: string;
};

const SLICE = (process.env.ACTOR_SLICE || 'posts') as Slice;
const API_BASE = (process.env.COMPANY_API_BASE_URL || '').replace(/\/+$/, '');
const API_KEY = process.env.COMPANY_API_KEY?.trim();
const EVENT = process.env.CHARGE_EVENT || 'company-posts';
const HARD_MAX = 50_000;
const DIRECT_ATTEMPTS = 5;
const LOOKUP_TIMEOUT_MS = 45_000;
const SECRET_KEY = /^(api[-_]?key|x-api-key|token|access[-_]?token|refresh[-_]?token|secret|password|authorization|credential|credentials)$/i;

function normalizeUrl(raw: unknown): string | null {
    if (typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value) return null;
    try {
        const url = new URL(value.startsWith('http') ? value : `https://${value}`);
        if (!/(^|\.)linkedin\.com$/i.test(url.hostname)) return null;
        const match = url.pathname.match(/\/company\/([^/?#]+)/i);
        if (!match) return null;
        url.protocol = 'https:';
        url.hostname = 'www.linkedin.com';
        url.pathname = `/company/${match[1]}`;
        url.search = '';
        url.hash = '';
        return url.toString();
    } catch {
        return null;
    }
}

function parseCsv(text: string): string[] {
    const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    if (!lines.length) return [];
    const split = (line: string) => line.split(',').map((part) => part.trim().replace(/^"|"$/g, ''));
    const first = split(lines[0]).map((part) => part.toLowerCase());
    const hasHeader = first.some((part) => ['url', 'linkedinurl', 'linkedin_url', 'companyurl', 'company_url'].includes(part));
    const urlIndex = hasHeader
        ? Math.max(first.findIndex((part) => ['url', 'linkedinurl', 'linkedin_url', 'companyurl', 'company_url'].includes(part)), 0)
        : 0;
    return lines.slice(hasHeader ? 1 : 0).map((line) => split(line)[urlIndex] || '');
}

async function collectUrls(input: Input): Promise<string[]> {
    const raw = [...(input.urls || [])];
    if (input.urlsCsv) raw.push(...parseCsv(input.urlsCsv));
    if (input.fileUrl) {
        const response = await fetch(input.fileUrl, { signal: AbortSignal.timeout(120_000) });
        if (!response.ok) throw new Error(`Could not download input file (HTTP ${response.status}).`);
        raw.push(...parseCsv(await response.text()));
    }
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const value of raw) {
        const url = normalizeUrl(value);
        if (!url || seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
    }
    return urls;
}

function stripSecrets(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(stripSecrets);
    if (!value || typeof value !== 'object') return value;
    const output: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (SECRET_KEY.test(key)) continue;
        output[key] = stripSecrets(child);
    }
    return output;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function cleanError(error: unknown, fallback: string): string {
    const message = error instanceof Error ? error.message : fallback;
    return message.replace(/https?:\/\/\S+/gi, 'the lookup service');
}

function permanentStatus(status: number): boolean {
    return status === 400 || status === 401 || status === 402 || status === 404 || status === 409 || status === 422;
}

function stalled(error: unknown): boolean {
    if (!(error instanceof Error)) return false;
    const message = error.message.toLowerCase();
    return error.name === 'TimeoutError' || error.name === 'AbortError' || message.includes('fetch failed') || message.includes('network') || message.includes('timed out');
}

function backoff(attempt: number): number {
    return Math.min(8000, 1000 * (2 ** attempt));
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function asList(value: unknown): unknown[] {
    return Array.isArray(value) ? value : [];
}

function text(value: unknown): string | null {
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    if (typeof value !== 'string') return null;
    const trimmed = value.trim();
    return trimmed || null;
}

function countOrNull(value: unknown): number | null {
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function joinNamed(value: unknown): string | null {
    const names = asList(value).map((item) => text(asRecord(item)?.name)).filter((name): name is string => !!name);
    return names.length ? names.join('; ') : null;
}

function checkedAt(): string {
    return new Date().toISOString();
}

async function apiLookup(url: string): Promise<Record<string, unknown>> {
    let lastError = 'Company lookup failed';
    for (let attempt = 0; attempt < DIRECT_ATTEMPTS; attempt += 1) {
        try {
            const response = await fetch(`${API_BASE}/api/v1/company-lockup`, {
                method: 'POST',
                headers: {
                    Accept: 'application/json',
                    'Content-Type': 'application/json',
                    'User-Agent': `Mawsool-Apify-Company-${SLICE}/1.0`,
                    'x-api-key': API_KEY!,
                },
                body: JSON.stringify({ url }),
                signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
            });
            const raw = await response.text();
            let body: Record<string, unknown> | null = null;
            try { body = JSON.parse(raw) as Record<string, unknown>; } catch { /* handled below */ }
            if (response.ok && body) return stripSecrets(body) as Record<string, unknown>;
            lastError = body && typeof body.error === 'string' ? body.error : `Company lookup failed with HTTP ${response.status}`;
            if (permanentStatus(response.status)) break;
            log.warning(`Company lookup attempt ${attempt + 1} of ${DIRECT_ATTEMPTS} did not succeed. Retrying.`);
        } catch (error) {
            lastError = stalled(error) ? 'The company lookup did not answer in time.' : cleanError(error, 'Network request failed');
            log.warning(`Company lookup attempt ${attempt + 1} of ${DIRECT_ATTEMPTS} did not succeed. Retrying.`);
        }
        if (attempt < DIRECT_ATTEMPTS - 1) await sleep(backoff(attempt));
    }
    throw new Error(lastError.replace(/https?:\/\/\S+/gi, 'the lookup service'));
}

function slugHash(url: string): string {
    return createHash('sha256').update(url).digest('hex');
}

function postId(post: Record<string, unknown>): string | null {
    return text(post.id) || text(post.urn) || text(post.link);
}

function mapPost(company: Record<string, unknown>, inputUrl: string, post: Record<string, unknown>, postCount: number, changeType?: string): Record<string, unknown> {
    const author = asRecord(post.author);
    const hashtags = asList(post.hashtags).map((item) => text(item)).filter((item): item is string => !!item);
    return {
        inputUrl,
        companyName: text(company.name),
        companyUrl: text(company.url) || inputUrl,
        success: true,
        postCount,
        postId: postId(post),
        postUrl: text(post.link),
        postedAt: text(post.date) || text(post.posted),
        text: text(post.text),
        hashtags: hashtags.length ? hashtags.join(' ') : null,
        reactions: countOrNull(post.reactions),
        comments: countOrNull(post.comments),
        authorName: text(author?.name),
        authorUrl: text(author?.link),
        authorType: text(author?.type),
        imageCount: asList(post.images).length,
        videoCount: asList(post.videos).length,
        taggedCompanies: joinNamed(post.tagged_companies),
        taggedPeople: joinNamed(post.tagged_people),
        isRepost: !!asRecord(post.repost),
        ...(changeType ? { changeType } : {}),
        checkedAt: checkedAt(),
    };
}

function emptyPost(company: Record<string, unknown>, inputUrl: string, changeType?: string): Record<string, unknown> {
    return {
        inputUrl,
        companyName: text(company.name),
        companyUrl: text(company.url) || inputUrl,
        success: true,
        postCount: 0,
        postId: null,
        postUrl: null,
        postedAt: null,
        text: null,
        hashtags: null,
        reactions: null,
        comments: null,
        authorName: null,
        authorUrl: null,
        authorType: null,
        imageCount: 0,
        videoCount: 0,
        taggedCompanies: null,
        taggedPeople: null,
        isRepost: false,
        ...(changeType ? { changeType } : {}),
        checkedAt: checkedAt(),
    };
}

function mapSimilar(company: Record<string, unknown>, inputUrl: string): Record<string, unknown>[] {
    const items = asList(company.similar_companies);
    const base = {
        inputUrl,
        companyName: text(company.name),
        companyUrl: text(company.url) || inputUrl,
        success: true,
        similarCount: items.length,
        checkedAt: checkedAt(),
    };
    if (!items.length) {
        return [{ ...base, similarName: null, similarUrl: null, subtitle: null, location: null }];
    }
    return items.map((item) => {
        const row = asRecord(item) || {};
        return {
            ...base,
            similarName: text(row.title),
            similarUrl: text(row.Links) || text(row.links) || text(row.link) || text(row.url),
            subtitle: text(row.subtitle),
            location: text(row.location),
        };
    });
}

function mapLocations(company: Record<string, unknown>, inputUrl: string): Record<string, unknown>[] {
    const items = asList(company.locations);
    const base = {
        inputUrl,
        companyName: text(company.name),
        companyUrl: text(company.url) || inputUrl,
        headquarters: text(company.headquarters),
        success: true,
        locationCount: countOrNull(company.locations_count) ?? items.length,
        checkedAt: checkedAt(),
    };
    if (!items.length) {
        return [{ ...base, address: null, addressLine1: null, addressLine2: null, isPrimary: null }];
    }
    return items.map((item) => {
        const row = asRecord(item) || {};
        const lines = asList(row.lines).map((line) => text(line)).filter((line): line is string => !!line);
        return {
            ...base,
            address: text(row.address),
            addressLine1: lines[0] || null,
            addressLine2: lines[1] || null,
            isPrimary: typeof row.is_primary === 'boolean' ? row.is_primary : null,
        };
    });
}

async function postWebhook(webhookUrl: string, changes: Record<string, unknown>[]): Promise<void> {
    if (!changes.length) return;
    const parsed = new URL(webhookUrl);
    if (parsed.protocol !== 'https:') throw new Error('webhookUrl must use HTTPS.');
    const total = changes.length;
    for (let offset = 0; offset < changes.length; offset += 100) {
        const chunk = changes.slice(offset, offset + 100);
        const response = await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mawsool-Apify-Company-Post-Watch/1.0' },
            body: JSON.stringify({ actor: 'mawsool-linkedin-company-post-watch', changes: chunk, offset, total }),
            signal: AbortSignal.timeout(30_000),
        });
        if (!response.ok) throw new Error(`Webhook returned HTTP ${response.status}.`);
    }
}

await Actor.init();
if (!API_BASE || !API_KEY) throw new Error('Company lookup is not configured.');

const input = (await Actor.getInput<Input>()) || {};
const maxUrls = Math.min(Math.max(Number(input.maxUrls ?? 100), 1), HARD_MAX);
const urls = (await collectUrls(input)).slice(0, maxUrls);
if (!urls.length) throw new Error('No valid LinkedIn company URLs found. Use a linkedin.com/company/... URL, CSV, or file upload.');

const concurrency = Math.min(Math.max(Number(input.concurrency ?? 10), 1), 40);
const progressId = (input.resumeId || 'auto').replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 60) || 'auto';
const saveProgress = urls.length > 20 || !!input.resumeId;
const skipFinished = saveProgress && !input.freshStart && (urls.length > 200 || !!input.resumeId);
const resumeStore = saveProgress
    ? await Actor.openKeyValueStore(input.resumeId ? `mawsool-company-${SLICE}-resume-${progressId}` : `mawsool-company-${SLICE}-progress-auto`)
    : null;
const watchStore = SLICE === 'post-watch'
    ? await Actor.openKeyValueStore(input.stateStoreName || 'mawsool-linkedin-company-post-watch')
    : null;
const watchPrefix = (input.watchId || 'default').replace(/[^a-zA-Z0-9-_]/g, '-').slice(0, 50);

log.info(`Starting ${urls.length} company ${SLICE} lookup(s), concurrency=${concurrency}`);
if (skipFinished) log.info('Finished companies from an earlier run of this list are skipped. Set freshStart to look them up again.');

let batch = urls;
let deferFailures = urls.length > 1;
let nextIndex = 0;
const deferred: string[] = [];
let processed = 0;
let succeeded = 0;
let failed = 0;
let skipped = 0;
let outputRows = 0;
let newPosts = 0;
let stop = false;
let consecutiveOutages = 0;
const webhookChanges: Record<string, unknown>[] = [];

function noteOutcome(message: string | null): void {
    if (!message) {
        consecutiveOutages = 0;
        return;
    }
    const textValue = message.toLowerCase();
    const outage = textValue.includes('did not answer') || textValue.includes('timed out') || textValue.includes('fetch failed') || textValue.includes('network') || textValue.includes('unavailable') || textValue.includes('unexpected response') || textValue.includes('403') || textValue.includes('429') || textValue.includes('502') || textValue.includes('503') || textValue.includes('504');
    if (!outage) {
        consecutiveOutages = 0;
        return;
    }
    consecutiveOutages += 1;
    if (consecutiveOutages >= 15 && !stop) {
        stop = true;
        log.error('The lookup service looks unavailable. Stopping so finished rows stay saved and the next run can continue.');
    }
}

async function emit(rows: Record<string, unknown>[]): Promise<boolean> {
    if (!rows.length) {
        const charge = await Actor.charge({ eventName: EVENT, count: 1 });
        return !charge?.eventChargeLimitReached;
    }
    const first = await Actor.pushData(rows[0], EVENT);
    if (first?.eventChargeLimitReached) return false;
    for (const row of rows.slice(1)) await Actor.pushData(row);
    outputRows += rows.length;
    return true;
}

function rowsFor(company: Record<string, unknown>, inputUrl: string, changeType?: string): Record<string, unknown>[] {
    if (SLICE === 'similar') return mapSimilar(company, inputUrl);
    if (SLICE === 'locations') return mapLocations(company, inputUrl);
    const posts = asList(company.recent_updates).map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => !!item);
    if (!posts.length) return [emptyPost(company, inputUrl, changeType)];
    return posts.map((post) => mapPost(company, inputUrl, post, posts.length, changeType));
}

async function worker(): Promise<void> {
    while (!stop) {
        const index = nextIndex++;
        if (index >= batch.length) return;
        const url = batch[index];
        const recordKey = slugHash(url);
        if (skipFinished && resumeStore && await resumeStore.getValue(`done-${recordKey}`)) {
            skipped += 1;
            continue;
        }
        try {
            const company = await apiLookup(url);
            let rows: Record<string, unknown>[];
            if (SLICE === 'post-watch' && watchStore) {
                const stateKey = `${watchPrefix}-${recordKey}`;
                const previous = input.freshStart ? null : await watchStore.getValue<{ ids?: string[] }>(stateKey);
                const seen = new Set(previous?.ids || []);
                const posts = asList(company.recent_updates).map((item) => asRecord(item)).filter((item): item is Record<string, unknown> => !!item);
                const ids = posts.map((post) => postId(post)).filter((id): id is string => !!id);
                const isBaseline = !previous;
                const selected = isBaseline ? posts : posts.filter((post) => {
                    const id = postId(post);
                    return !!id && !seen.has(id);
                });
                const changeType = isBaseline ? 'baseline' : 'new_post';
                rows = selected.length
                    ? selected.map((post) => mapPost(company, url, post, posts.length, changeType))
                    : (isBaseline ? [emptyPost(company, url, 'baseline')] : []);
                if (!isBaseline) newPosts += rows.length;
                const charged = await emit(rows);
                if (!charged) {
                    stop = true;
                    return;
                }
                if (!isBaseline) webhookChanges.push(...rows);
                await watchStore.setValue(stateKey, { ids: [...new Set([...seen, ...ids])], at: checkedAt() });
            } else {
                rows = rowsFor(company, url);
                const charged = await emit(rows);
                if (!charged) {
                    stop = true;
                    return;
                }
            }
            if (resumeStore) await resumeStore.setValue(`done-${recordKey}`, { at: checkedAt() });
            noteOutcome(null);
            processed += 1;
            succeeded += 1;
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unexpected company lookup error';
            noteOutcome(message);
            if (deferFailures && !stop) {
                deferred.push(url);
                log.warning(`Company lookup failed and will be retried at the end: ${message}`);
                continue;
            }
            const charge = await Actor.pushData({
                inputUrl: url,
                success: false,
                error: message,
                checkedAt: checkedAt(),
            }, EVENT);
            if (charge?.eventChargeLimitReached) stop = true;
            processed += 1;
            failed += 1;
            outputRows += 1;
            log.warning(`Failed company lookup: ${message}`);
        }
    }
}

async function runBatch(): Promise<void> {
    nextIndex = 0;
    const workers = Math.min(concurrency, batch.length);
    if (workers > 0) await Promise.all(Array.from({ length: workers }, () => worker()));
}

await runBatch();
if (deferred.length && !stop) {
    log.info(`Retrying ${deferred.length} company lookup(s) that failed on the first pass.`);
    await sleep(3000);
    batch = deferred.splice(0, deferred.length);
    deferFailures = false;
    await runBatch();
}

if (SLICE === 'post-watch' && input.webhookUrl && webhookChanges.length) {
    try {
        await postWebhook(input.webhookUrl, webhookChanges);
    } catch (error) {
        log.error(`Change webhook failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}

await Actor.setValue('OUTPUT', {
    slice: SLICE,
    requested: urls.length,
    processed,
    succeeded,
    failed,
    skipped,
    outputRows,
    newPosts: SLICE === 'post-watch' ? newPosts : undefined,
    stoppedByChargeLimit: stop,
});
log.info(`Finished. Processed=${processed}, succeeded=${succeeded}, failed=${failed}, skipped=${skipped}, rows=${outputRows}`);
await Actor.exit();
