const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');

const { runMigrationsAndEnsure } = require('../src/db/migrate');
const dramaExportService = require('../src/services/dramaExportService');
const dramaImportService = require('../src/services/dramaImportService');
const uploadService = require('../src/services/uploadService');
const { VALID_PNG_BYTES } = require('./mediaFixture');

const log = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

const SECRET_API_KEY = 'source-export-secret-api-key';
const SECRET_TOKEN = 'source-export-secret-access-token';

function createDb(withDrama = false) {
  const db = new Database(':memory:');
  runMigrationsAndEnsure(db);
  if (withDrama) {
    const now = '2026-07-16T12:00:00.000Z';
    db.prepare(
      `INSERT INTO dramas (id, title, status, metadata, created_at, updated_at)
       VALUES (1, 'Source Original Project', 'draft', '{}', ?, ?)`
    ).run(now, now);
  }
  return db;
}

function makeTempStorage(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function sourceBytes() {
  return [
    {
      title: 'PDF source',
      filename: 'story.pdf',
      extension: '.pdf',
      format: 'pdf',
      mime: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n'),
    },
    {
      title: 'PNG source',
      filename: 'panel.png',
      extension: '.png',
      format: 'png',
      mime: 'image/png',
      buffer: VALID_PNG_BYTES,
    },
    {
      title: 'MP4 source',
      filename: 'scene.mp4',
      extension: '.mp4',
      format: 'mp4',
      mime: 'video/mp4',
      buffer: Buffer.concat([
        Buffer.from([0x00, 0x00, 0x00, 0x18]),
        Buffer.from('ftypisom'),
        Buffer.from([0x00, 0x00, 0x00, 0x00]),
        Buffer.from('isomiso2portable-mp4-source'),
      ]),
    },
  ];
}

function insertSourceOriginal(db, storagePath, fixture, index) {
  const createdAt = new Date(Date.parse('2026-07-16T12:00:00.000Z') + (index * 1000)).toISOString();
  const contentHash = createHash('sha256').update(`derived:${fixture.title}`).digest('hex');
  const info = db.prepare(
    `INSERT INTO story_sources
     (drama_id, source_type, title, raw_text_path, content_hash, metadata, created_at)
     VALUES (1, 'novel', ?, ?, ?, '{}', ?)`
  ).run(
    fixture.title,
    `data/story_sources/1/${contentHash}.txt`,
    contentHash,
    createdAt
  );
  const sourceId = Number(info.lastInsertRowid);
  const artifact = uploadService.persistStorySourceOriginal(
    storagePath,
    1,
    sourceId,
    fixture,
    {
      reserveBytes: 0,
      getAvailableBytes: () => Number.POSITIVE_INFINITY,
    }
  );
  const metadata = {
    uploaded_filename: fixture.filename,
    uploaded_mimetype: fixture.mime,
    imported_from: 'source_intake_upload',
    api_key: SECRET_API_KEY,
    nested: {
      access_token: SECRET_TOKEN,
      retained_label: fixture.title,
    },
    original_file: artifact.metadata,
  };
  db.prepare('UPDATE story_sources SET metadata = ? WHERE id = ?')
    .run(JSON.stringify(metadata), sourceId);
  return { sourceId, artifact, metadata };
}

function exportFixture(t, fixtures = sourceBytes()) {
  const sourceStorage = makeTempStorage('lmd-source-export-');
  const sourceDb = createDb(true);
  const seeded = fixtures.map((fixture, index) => insertSourceOriginal(
    sourceDb,
    sourceStorage,
    fixture,
    index
  ));
  t.after(() => {
    sourceDb.close();
    fs.rmSync(sourceStorage, { recursive: true, force: true });
  });
  const exported = dramaExportService.exportDrama(
    sourceDb,
    { storage: { local_path: sourceStorage } },
    log,
    1
  );
  return { exported, fixtures, seeded, sourceStorage };
}

function importIntoEmptyTarget(t, archive, options = {}) {
  const targetStorage = makeTempStorage('lmd-source-import-');
  const targetDb = createDb(false);
  t.after(() => {
    targetDb.close();
    fs.rmSync(targetStorage, { recursive: true, force: true });
  });
  const run = () => dramaImportService.importDrama(
    targetDb,
    { storage: { local_path: targetStorage } },
    log,
    archive,
    {
      getAvailableBytes: () => Number.POSITIVE_INFINITY,
      ...options,
    }
  );
  return { targetDb, targetStorage, run };
}

function rewriteProject(archiveBuffer, mutate) {
  const zip = new AdmZip(archiveBuffer);
  const project = JSON.parse(zip.readAsText('project.json'));
  mutate(project, zip);
  zip.updateFile('project.json', Buffer.from(JSON.stringify(project, null, 2), 'utf8'));
  return zip.toBuffer();
}

function assertNoImportResidue(db, storagePath) {
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM dramas').get().count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM story_sources').get().count, 0);
  assert.deepEqual(fs.readdirSync(storagePath), []);
}

describe('Source Intake original project export/import', () => {
  it('round-trips PDF, PNG, and MP4 originals byte-for-byte with rewritten metadata', (t) => {
    const fixture = exportFixture(t);
    const archive = new AdmZip(fixture.exported.buffer);
    const projectText = archive.readAsText('project.json');
    const project = JSON.parse(projectText);

    assert.equal(project.source_intake.manifest_version, 1);
    assert.equal(project.source_intake.hash_algorithm, 'sha256');
    assert.equal(project.source_intake.sources.length, 3);
    assert.equal(projectText.includes(SECRET_API_KEY), false);
    assert.equal(projectText.includes(SECRET_TOKEN), false);
    assert.equal(projectText.includes('original_file'), false);
    for (let index = 0; index < fixture.fixtures.length; index++) {
      const source = project.source_intake.sources[index];
      assert.match(source.source_ref, /^source_\d{4}$/);
      assert.equal(source.original.size, fixture.fixtures[index].buffer.length);
      assert.equal(source.original.mime, fixture.fixtures[index].mime);
      assert.deepEqual(archive.readFile(source.original.archive_path), fixture.fixtures[index].buffer);
    }

    const target = importIntoEmptyTarget(t, fixture.exported.buffer);
    const imported = target.run();
    const rows = target.targetDb.prepare(
      'SELECT * FROM story_sources WHERE drama_id = ? AND deleted_at IS NULL ORDER BY created_at, id'
    ).all(imported.drama_id);
    assert.equal(rows.length, 3);

    for (let index = 0; index < rows.length; index++) {
      const metadata = JSON.parse(rows[index].metadata);
      assert.equal(Object.hasOwn(metadata, 'api_key'), false);
      assert.equal(Object.hasOwn(metadata.nested, 'access_token'), false);
      assert.equal(metadata.nested.retained_label, fixture.fixtures[index].title);
      assert.equal(metadata.imported_via, 'project_archive');
      assert.equal(metadata.archive_source_ref, `source_${String(index + 1).padStart(4, '0')}`);
      assert.match(
        metadata.original_file.storage_path,
        new RegExp(`^story_sources/${imported.drama_id}/${rows[index].id}/original/[0-9a-f-]+\\.[a-z0-9]+$`)
      );
      assert.notEqual(
        metadata.original_file.server_filename,
        fixture.seeded[index].metadata.original_file.server_filename
      );
      const restored = uploadService.readStorySourceOriginal(target.targetStorage, {
        ...rows[index],
        metadata,
      });
      assert.deepEqual(restored.buffer, fixture.fixtures[index].buffer);
      assert.equal(restored.mime, fixture.fixtures[index].mime);
      assert.equal(
        restored.sha256,
        createHash('sha256').update(fixture.fixtures[index].buffer).digest('hex')
      );
    }
  });

  it('strips secret URL fields recursively while preserving paths and ordinary query fields', (t) => {
    const storagePath = makeTempStorage('lmd-url-export-');
    const db = createDb(true);
    t.after(() => {
      db.close();
      fs.rmSync(storagePath, { recursive: true, force: true });
    });

    const now = '2026-07-16T13:00:00.000Z';
    const credentialMarker = 'LMD_SYNTHETIC_REMOTE_CREDENTIAL_7F31';
    const tokenMarker = 'LMD_SYNTHETIC_REMOTE_TOKEN_8A42';
    const signatureMarker = 'LMD_SYNTHETIC_REMOTE_SIGNATURE_9B53';
    const userInfoMarker = 'LMD_SYNTHETIC_REMOTE_USERINFO_0C64';
    const malformedMarker = 'LMD_SYNTHETIC_REMOTE_MALFORMED_1D75';
    const localMarker = 'LMD_SYNTHETIC_LOCAL_PATH_KEEP_2E86';
    const keyMarker = 'LMD_SYNTHETIC_REMOTE_KEY_3F97';
    const ordinaryUrl = 'https://cdn.example.test/ordinary.png?width=1280&format=webp#preview';
    const localMediaPath = `data/audio/voice.mp3?token=${localMarker}`;
    const signedAudioUrl =
      `https://media.example.test/voice.mp3?quality=high&maxTokens=4096&credential=${credentialMarker}`
      + `&TOKEN=${tokenMarker}&signature=${signatureMarker}#clip`;

    db.prepare('UPDATE dramas SET metadata = ? WHERE id = 1').run(JSON.stringify({
      ordinary_media_url: ordinaryUrl,
      signed_audio_url: signedAudioUrl,
      keyed_media_url: `https://media.example.test/keyed.png?key=${keyMarker}&format=webp`,
      local_media_path: localMediaPath,
      userinfo_image_url: `https://viewer:${userInfoMarker}@cdn.example.test/private.png`,
    }));
    const episodeId = Number(db.prepare(
      `INSERT INTO episodes (drama_id, episode_number, title, created_at, updated_at)
       VALUES (1, 1, 'Signed media', ?, ?)`
    ).run(now, now).lastInsertRowid);
    const storyboardId = Number(db.prepare(
      `INSERT INTO storyboards
       (episode_id, storyboard_number, title, video_url, last_frame_image_url, reference_images,
        created_at, updated_at)
       VALUES (?, 1, 'Credential scrub', ?, ?, ?, ?, ?)`
    ).run(
      episodeId,
      `https://video.example.test/clip.mp4?download=1&access_token=${tokenMarker}`,
      ordinaryUrl,
      JSON.stringify([
        {
          name: 'Remote reference',
          image_url: `//cdn.example.test/reference.png?width=640&X-Amz-Credential=${credentialMarker}`
            + `&X-Amz-Signature=${signatureMarker}`,
        },
        {
          name: 'Local reference',
          image_url: `/static/reference.png?token=${localMarker}`,
        },
      ]),
      now,
      now
    ).lastInsertRowid);
    db.prepare(
      `INSERT INTO image_generations
       (storyboard_id, image_url, status, created_at, updated_at)
       VALUES (?, ?, 'completed', ?, ?)`
    ).run(
      storyboardId,
      `https://images.example.test/frame.png?style=cinematic&sig=${signatureMarker}`,
      now,
      now
    );
    db.prepare(
      `INSERT INTO scenes
       (drama_id, episode_id, location, time, panorama_image_url, created_at, updated_at)
       VALUES (1, ?, 'Studio', 'Day', ?, ?, ?)`
    ).run(
      episodeId,
      `https://[invalid.example/panorama.jpg?token=${malformedMarker}`,
      now,
      now
    );

    const exported = dramaExportService.exportDrama(
      db,
      { storage: { local_path: storagePath } },
      log,
      1
    );
    const projectText = new AdmZip(exported.buffer).readAsText('project.json');
    for (const marker of [
      credentialMarker,
      tokenMarker,
      signatureMarker,
      userInfoMarker,
      malformedMarker,
      localMarker,
      keyMarker,
    ]) {
      assert.equal(projectText.includes(marker), false, `project.json leaked ${marker}`);
    }

    const project = JSON.parse(projectText);
    assert.equal(project.drama.metadata.ordinary_media_url, ordinaryUrl);
    assert.equal(project.drama.metadata.keyed_media_url, 'https://media.example.test/keyed.png?format=webp');
    assert.equal(project.drama.metadata.local_media_path, 'data/audio/voice.mp3');
    assert.equal(project.drama.metadata.userinfo_image_url, 'https://cdn.example.test/private.png');

    const audioUrl = new URL(project.drama.metadata.signed_audio_url);
    assert.equal(audioUrl.searchParams.get('quality'), 'high');
    assert.equal(audioUrl.searchParams.has('maxTokens'), false);
    assert.equal(audioUrl.searchParams.has('credential'), false);
    assert.equal(audioUrl.searchParams.has('TOKEN'), false);
    assert.equal(audioUrl.searchParams.has('signature'), false);

    const storyboard = project.episodes[0].storyboards[0];
    const videoUrl = new URL(storyboard.video_url);
    assert.deepEqual([...videoUrl.searchParams.keys()], ['download']);
    assert.equal(videoUrl.searchParams.get('download'), '1');
    assert.equal(videoUrl.searchParams.has('access_token'), false);
    assert.equal(storyboard.last_frame_image_url, ordinaryUrl);
    assert.equal(storyboard.reference_images[1].image_url, '/static/reference.png');

    const referenceUrl = new URL(`https:${storyboard.reference_images[0].image_url}`);
    assert.equal(referenceUrl.searchParams.get('width'), '640');
    assert.equal(referenceUrl.searchParams.has('X-Amz-Credential'), false);
    assert.equal(referenceUrl.searchParams.has('X-Amz-Signature'), false);
    const imageUrl = new URL(storyboard.image_generations[0].image_url);
    assert.equal(imageUrl.searchParams.get('style'), 'cinematic');
    assert.equal(imageUrl.searchParams.has('sig'), false);
    assert.equal(project.scenes[0].panorama_image_url, null);
  });

  it('drops remote-only and escaping media references from imported project archives', (t) => {
    const fixture = exportFixture(t, [sourceBytes()[0]]);
    const marker = 'LMD_SYNTHETIC_IMPORT_REMOTE_MEDIA_4A18';
    const remoteUrl = `http://127.0.0.1:65534/private.png?sig=${marker}`;
    const archive = rewriteProject(fixture.exported.buffer, (project) => {
      project.scenes = [{
        episode_index: 0,
        location: 'Imported room',
        time: 'Night',
        panorama_image_url: remoteUrl,
      }];
      project.episodes = [{
        episode_number: 1,
        title: 'Unsafe media fixture',
        script_content: 'Fixture',
        storyboards: [{
          storyboard_number: 1,
          title: 'Remote-only frame',
          scene_index: 0,
          image_generations: [{
            original_id: 91,
            frame_type: 'first',
            status: 'completed',
            image_url: remoteUrl,
          }],
          first_frame_image_original_id: 91,
          last_frame_image_url: remoteUrl,
          last_frame_local_path: '../../outside.png',
          video_url: `http://169.254.169.254/latest/meta-data?key=${marker}`,
          reference_images: [{ name: 'Remote reference', image_url: remoteUrl }],
        }],
      }];
    });

    const target = importIntoEmptyTarget(t, archive);
    const imported = target.run();
    const storyboard = target.targetDb.prepare(
      `SELECT image_url, local_path, last_frame_image_url, last_frame_local_path,
              video_url, video_local_path, reference_images
         FROM storyboards WHERE episode_id IN (SELECT id FROM episodes WHERE drama_id = ?)`
    ).get(imported.drama_id);
    const scene = target.targetDb.prepare(
      'SELECT panorama_image_url, panorama_local_path FROM scenes WHERE drama_id = ?'
    ).get(imported.drama_id);

    assert.deepEqual(storyboard, {
      image_url: null,
      local_path: null,
      last_frame_image_url: null,
      last_frame_local_path: null,
      video_url: null,
      video_local_path: null,
      reference_images: null,
    });
    assert.deepEqual(scene, { panorama_image_url: null, panorama_local_path: null });
    assert.equal(target.targetDb.prepare('SELECT COUNT(*) AS count FROM image_generations').get().count, 0);
    assert.equal(target.targetDb.prepare('SELECT COUNT(*) AS count FROM video_generations').get().count, 0);
    assert.equal(JSON.stringify({ storyboard, scene }).includes(marker), false);
  });

  it('rejects a tampered original hash and leaves no database or filesystem residue', (t) => {
    const fixture = exportFixture(t, [sourceBytes()[0]]);
    const tampered = rewriteProject(fixture.exported.buffer, (project, zip) => {
      zip.updateFile(
        project.source_intake.sources[0].original.archive_path,
        Buffer.from('%PDF-1.4\ntampered-source\n%%EOF\n')
      );
    });
    const target = importIntoEmptyTarget(t, tampered);
    assert.throws(target.run, (error) => error?.code === 'SOURCE_ORIGINAL_SIZE_MISMATCH');
    assertNoImportResidue(target.targetDb, target.targetStorage);
  });

  it('rejects a same-size hash tamper before writing the original', (t) => {
    const fixture = exportFixture(t, [sourceBytes()[1]]);
    const tampered = rewriteProject(fixture.exported.buffer, (project, zip) => {
      const originalPath = project.source_intake.sources[0].original.archive_path;
      const bytes = Buffer.from(zip.readFile(originalPath));
      bytes[bytes.length - 1] ^= 0x01;
      zip.updateFile(originalPath, bytes);
    });
    const target = importIntoEmptyTarget(t, tampered);
    assert.throws(target.run, (error) => error?.code === 'SOURCE_ORIGINAL_HASH_MISMATCH');
    assertNoImportResidue(target.targetDb, target.targetStorage);
  });

  it('rejects manifest path traversal before creating staging data', (t) => {
    const fixture = exportFixture(t, [sourceBytes()[0]]);
    const escaped = rewriteProject(fixture.exported.buffer, (project) => {
      project.source_intake.sources[0].original.archive_path = '../outside.pdf';
    });
    const target = importIntoEmptyTarget(t, escaped);
    assert.throws(target.run, (error) => error?.code === 'UNSAFE_ARCHIVE_PATH');
    assertNoImportResidue(target.targetDb, target.targetStorage);
  });

  it('rejects a MIME/signature mismatch without retaining source rows or files', (t) => {
    const fixture = exportFixture(t, [sourceBytes()[0]]);
    const mismatched = rewriteProject(fixture.exported.buffer, (project) => {
      project.source_intake.sources[0].original.mime = 'image/png';
    });
    const target = importIntoEmptyTarget(t, mismatched);
    assert.throws(target.run, (error) => error?.code === 'SOURCE_ORIGINAL_MIME_MISMATCH');
    assertNoImportResidue(target.targetDb, target.targetStorage);
  });

  it('removes committed project and source directories when the transaction commit is faulted', (t) => {
    const fixture = exportFixture(t, [sourceBytes()[2]]);
    const target = importIntoEmptyTarget(t, fixture.exported.buffer, {
      faultInjector(step) {
        if (step === 'after-file-commit') throw new Error('injected source original commit failure');
      },
    });
    assert.throws(target.run, /injected source original commit failure/);
    assertNoImportResidue(target.targetDb, target.targetStorage);
  });

  it('uses the configured per-drama original quota during project import', (t) => {
    const fixture = exportFixture(t, [sourceBytes()[0]]);
    const targetStorage = makeTempStorage('lmd-source-import-quota-');
    const targetDb = createDb(false);
    t.after(() => {
      targetDb.close();
      fs.rmSync(targetStorage, { recursive: true, force: true });
    });

    assert.throws(
      () => dramaImportService.importDrama(
        targetDb,
        {
          storage: {
            local_path: targetStorage,
            story_source_original_quota_bytes: fixture.fixtures[0].buffer.length - 1,
          },
        },
        log,
        fixture.exported.buffer,
        { getAvailableBytes: () => Number.POSITIVE_INFINITY }
      ),
      (error) => error?.code === 'SOURCE_ORIGINAL_QUOTA_EXCEEDED'
    );
    assertNoImportResidue(targetDb, targetStorage);
  });

  it('keeps legacy project archives without source_intake compatible', (t) => {
    const zip = new AdmZip();
    zip.addFile('project.json', Buffer.from(JSON.stringify({
      version: '1.6',
      drama: { title: 'Legacy archive', metadata: {} },
      episodes: [],
      characters: [],
      scenes: [],
      props: [],
    }), 'utf8'));
    const target = importIntoEmptyTarget(t, zip.toBuffer());
    const imported = target.run();
    assert.equal(imported.title, 'Legacy archive');
    assert.equal(target.targetDb.prepare('SELECT COUNT(*) AS count FROM story_sources').get().count, 0);
  });
});
