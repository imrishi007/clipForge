import os
import tempfile
import pytest

os.environ['CLIPFORGE_DATA_DIR'] = tempfile.mkdtemp(prefix='clipforge-tests-')
from apps.api.main import app  # noqa: E402
from apps.api.database import Base, engine  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


@pytest.fixture
def client():
    Base.metadata.drop_all(engine)
    with TestClient(app) as client:
        yield client


@pytest.fixture
def database():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    yield
