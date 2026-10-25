import sys
from types import SimpleNamespace

from scripts import fetch_data


def test_runtime_data_downloads_use_one_pinned_revision(tmp_path, monkeypatch):
    calls = []
    monkeypatch.setenv('HOUND_DATA_REPO', 'example/private-data')
    monkeypatch.setenv('HF_TOKEN', 'test-only')
    monkeypatch.setenv('HOUND_DATA_DIR', str(tmp_path))
    monkeypatch.setenv('HOUND_DATA_REVISION', 'pinned-dataset-commit')
    def download(**kwargs):
        calls.append(kwargs)
        return tmp_path / kwargs['filename']
    monkeypatch.setitem(sys.modules, 'huggingface_hub', SimpleNamespace(hf_hub_download=download))
    assert fetch_data.main() == 0
    assert len(calls) == len(fetch_data.DATA_FILES + fetch_data.OPTIONAL_DATA_FILES)
    assert {call['revision'] for call in calls} == {'pinned-dataset-commit'}
