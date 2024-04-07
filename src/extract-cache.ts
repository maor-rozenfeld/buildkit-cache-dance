import fs from 'fs/promises';
import path from 'path';
import { Opts, getCacheMap } from './opts.js';
import { run, runPiped } from './run.js';
import { spawn } from 'child_process';

async function extractCache(cacheSource: string, cacheTarget: string, scratchDir: string) {
    console.log(`Creating docker cache buster and Dockerfile...`);
    const date = new Date().toISOString();
    await fs.writeFile(path.join(scratchDir, 'buildstamp'), date);

    // Prepare Dancefile to Access Caches
    const dancefileContent = `
FROM busybox:1
COPY buildstamp buildstamp
RUN --mount=type=cache,target=${cacheTarget} \
    mkdir -p /var/dance-cache/ \
    && cp -p -R ${cacheTarget}/. /var/dance-cache/ || true
`;
    await fs.writeFile(path.join(scratchDir, 'Dancefile.extract'), dancefileContent);
    console.log(dancefileContent);

    console.log('Building docker image...')
    await run('docker', ['buildx', 'build', '-f', path.join(scratchDir, 'Dancefile.extract'), '--tag', 'dance:extract', '--load', scratchDir]);

    // Create Extraction Image
    try {
        await run('docker', ['rm', '-f', 'cache-container']);
    } catch (error) {
        // Ignore error if container does not exist
    }

    console.log(`Extracting cache to scratch dir ${scratchDir}...`)
    await run('docker', ['create', '-ti', '--name', 'cache-container', 'dance:extract']);

    // Unpack Docker Image into Scratch
    await runPiped(
        ['docker', ['cp', '-L', 'cache-container:/var/dance-cache', '-']],
        ['tar', ['-H', 'posix', '-x', '-C', scratchDir]]
    );

    console.log(`Cache source directory: ${cacheSource}`);
    console.log(`Cache source original size: ${await run('/bin/sh', ['-c', `du -sh ${cacheSource} | cut -f1`])}`);
    console.log(`Cache source extracted size: ${await run('/bin/sh', ['-c', `du -sh ${path.join(scratchDir, 'dance-cache')} | cut -f1`])}`);
    // Move Cache into Its Place
    await fs.rm(cacheSource, { recursive: true, force: true });
    await fs.rename(path.join(scratchDir, 'dance-cache'), cacheSource);
    console.log('Replaced cache source with the extracted cache.');
}

export async function extractCaches(opts: Opts) {
    if (opts["skip-extraction"]) {
        console.log("skip-extraction is set. Skipping extraction step...");
        return;
    }

    const cacheMap = getCacheMap(opts);
    const scratchDir = opts['scratch-dir'];

    // Extract Caches for each source-target pair
    for (const [cacheSource, cacheTarget] of Object.entries(cacheMap)) {
        await extractCache(cacheSource, cacheTarget, scratchDir);
    }
}
