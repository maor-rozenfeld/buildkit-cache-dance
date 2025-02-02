import fs from 'fs/promises';
import path from 'path';
import { Opts, getCacheMap } from './opts.js';
import { run } from './run.js';
import { notice } from '@actions/core';

async function injectCache(cacheSource: string, cacheTarget: string, scratchDir: string) {
    // Clean Scratch Directory
    await fs.rm(scratchDir, { recursive: true, force: true });
    await fs.mkdir(scratchDir, { recursive: true });

    // Prepare Cache Source Directory
    await fs.mkdir(cacheSource, { recursive: true });

    // Prepare Timestamp for Layer Cache Busting
    const date = new Date().toISOString();
    await fs.writeFile(path.join(cacheSource, 'buildstamp'), date);

    // Prepare Dancefile to Access Caches
    const dancefileContent = `
FROM busybox:1
COPY buildstamp buildstamp
RUN --mount=type=cache,target=${cacheTarget} \
    --mount=type=bind,source=.,target=/var/dance-cache \
    cp -p -R /var/dance-cache/. ${cacheTarget} || true
`;
    await fs.writeFile(path.join(scratchDir, 'Dancefile.inject'), dancefileContent);
    console.log(dancefileContent);

    // Inject Data into Docker Cache
    await run('docker', ['buildx', 'build', '-f', path.join(scratchDir, 'Dancefile.inject'), '--tag', 'dance:inject', cacheSource]);

    // Clean Directories
    try {
        await fs.rm(cacheSource, { recursive: true, force: true });
    } catch (err) {
        // Ignore Cleaning Errors
        notice(`Error while cleaning cache source directory: ${err}. Ignoring...`);
    }
}


export async function injectCaches(opts: Opts) {
    const cacheMap = getCacheMap(opts);
    const scratchDir = opts['scratch-dir'];

    // Inject Caches for each source-target pair
    for (const [cacheSource, cacheTarget] of Object.entries(cacheMap)) {
        await injectCache(cacheSource, cacheTarget, scratchDir);
    }
}
