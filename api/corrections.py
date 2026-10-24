"""Correction vectors and versions, scoped to a model and base dataset.

Only embeddings are stored. The existing five-column audit table is unchanged.
A new base index/graph gets a different context; old records are retained but
are never automatically applied to a different mapping package.
"""
import hashlib
import json
import os

import numpy as np


def index_context(data_dir, model, router):
    digest = hashlib.sha256(model.model_name.encode('utf-8'))
    digest.update(os.getenv('HOUND_DATASET_ID', str(data_dir.resolve())).encode('utf-8'))
    for name in ('index.npz', 'graph.json'):
        path = data_dir / name
        digest.update(name.encode('ascii'))
        if path.exists():
            with path.open('rb') as handle:
                for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                    digest.update(chunk)
        elif name == 'graph.json':
            digest.update(json.dumps(router.nodes, sort_keys=True).encode('utf-8'))
    return digest.hexdigest()


class CorrectionStore:
    def __init__(self, db, context):
        self.db, self.context = db, context
        db.execute('CREATE TABLE IF NOT EXISTS correction_vectors ('
                   'photo_id TEXT PRIMARY KEY REFERENCES corrections(photo_id) ON DELETE CASCADE, '
                   'context TEXT NOT NULL, vector BLOB NOT NULL)')
        db.execute('CREATE TABLE IF NOT EXISTS index_versions ('
                   'context TEXT PRIMARY KEY, version INTEGER NOT NULL)')
        db.commit()

    @property
    def version(self):
        row = self.db.execute('SELECT version FROM index_versions WHERE context = ?',
                              (self.context,)).fetchone()
        return row[0] if row else 0

    def records(self):
        rows = self.db.execute(
            'SELECT c.photo_id, c.true_spot, v.vector FROM corrections c '
            'JOIN correction_vectors v ON c.photo_id = v.photo_id '
            'WHERE v.context = ? ORDER BY c.rowid', (self.context,)).fetchall()
        records = []
        for photo_id, label, blob in rows:
            if len(blob) != 384 * 4:
                raise ValueError('Stored correction vector has invalid dimensions')
            vector = np.frombuffer(blob, dtype='<f4').copy()
            norm = np.linalg.norm(vector.astype(np.float64))
            if not np.isfinite(vector).all() or not np.isfinite(norm) or not np.isclose(norm, 1, atol=0.01):
                raise ValueError('Stored correction vector is invalid')
            records.append((photo_id, label, vector))
        return records

    def add(self, photo_id, vector):
        # Caller owns the encompassing SQLite transaction and index rollback.
        self.db.execute('INSERT INTO correction_vectors VALUES (?, ?, ?)',
                        (photo_id, self.context, vector.astype('<f4').tobytes()))
        self.advance_version()

    def remove(self, photo_id):
        self.db.execute('DELETE FROM correction_vectors WHERE photo_id = ? AND context = ?',
                        (photo_id, self.context))
        self.db.execute('DELETE FROM corrections WHERE photo_id = ?', (photo_id,))
        self.advance_version()

    def advance_version(self):
        self.db.execute('INSERT INTO index_versions VALUES (?, 1) '
                        'ON CONFLICT(context) DO UPDATE SET version = version + 1', (self.context,))
