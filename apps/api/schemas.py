from typing import Literal
from pydantic import BaseModel, ConfigDict, Field, model_validator


class CaptionWord(BaseModel):
    model_config = ConfigDict(extra='forbid')
    startMs: int = Field(ge=0)
    endMs: int = Field(gt=0)
    text: str = Field(min_length=1, max_length=200, pattern=r'^\S+$')


class Caption(BaseModel):
    model_config = ConfigDict(extra='forbid')
    id: str
    startMs: int = Field(ge=0)
    endMs: int = Field(gt=0)
    text: str = Field(max_length=2000)
    words: list[CaptionWord] = Field(default_factory=list, max_length=64)

    @model_validator(mode='after')
    def valid_range(self):
        if self.endMs <= self.startMs:
            raise ValueError('Caption end must follow start')
        end = self.startMs
        for word in self.words:
            if word.startMs < end or not word.startMs < word.endMs <= self.endMs:
                raise ValueError('Word timings must be ordered inside the caption')
            end = word.endMs
        if self.words and self.text.split() != [word.text for word in self.words]:
            raise ValueError('Caption text must match aligned words')
        return self


class FramingKeyframe(BaseModel):
    model_config = ConfigDict(extra='forbid')
    timeMs: int = Field(ge=0)
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    cut: bool = False


class SourceSegment(BaseModel):
    model_config = ConfigDict(extra='forbid')
    startMs: int = Field(ge=0)
    endMs: int = Field(gt=0)


class EditDocument(BaseModel):
    model_config = ConfigDict(extra='forbid')
    schemaVersion: Literal[1] = 1
    revision: int = Field(default=0, ge=0)
    sourceInMs: int = Field(default=0, ge=0)
    sourceOutMs: int = Field(default=12000, gt=0)
    sourceSegments: list[SourceSegment] = Field(default_factory=list, max_length=32)
    cutFadeMs: int = Field(default=0, ge=0, le=250)
    ratio: Literal['9:16', '4:5', '1:1', '16:9'] = '9:16'
    resolution: Literal['540', '720', '1080'] = '1080'
    fps: Literal[24, 30, 60] = 30
    preserveSourceFps: bool = False
    quality: Literal['high', 'standard', 'compact'] = 'standard'
    cropMode: Literal['fill', 'fit'] = 'fill'
    focalX: float = Field(default=.5, ge=0, le=1)
    focalY: float = Field(default=.5, ge=0, le=1)
    framingKeyframes: list[FramingKeyframe] = Field(default_factory=list, max_length=96)
    zoomPercent: int = Field(default=100, ge=100, le=150)
    saturation: float = Field(default=1, ge=0, le=2)
    volume: float = Field(default=1, ge=0, le=2)
    loudnessGainDb: float = Field(default=0, ge=-24, le=24)
    reduceRumble: bool = False
    fadeIn: float = Field(default=0, ge=0, le=5)
    fadeOut: float = Field(default=0, ge=0, le=5)
    captions: list[Caption] = Field(default_factory=list, max_length=1000)
    fontSize: float = Field(default=52, ge=16, le=120)
    fontFamily: Literal['Nirmala UI', 'Arial', 'Noto Sans Devanagari'] = 'Nirmala UI'
    color: str = Field(default='#FFFFFF', pattern=r'^#[0-9A-Fa-f]{6}$')
    outline: float = Field(default=2, ge=0, le=6)
    captionY: float = Field(default=78, ge=10, le=90)
    bold: bool = True
    captionBackground: bool = False
    captionAnimation: Literal['none', 'fade', 'pop'] = 'none'
    captionHighlight: str | None = Field(default=None, pattern=r'^#[0-9A-Fa-f]{6}$')
    captionShadow: float = Field(default=0, ge=0, le=8)

    @model_validator(mode='after')
    def valid_range(self):
        if self.sourceOutMs <= self.sourceInMs:
            raise ValueError('End must follow start')
        segments = self.sourceSegments
        if segments and (segments[0].startMs != self.sourceInMs or segments[-1].endMs != self.sourceOutMs
                         or any(s.startMs >= s.endMs for s in segments)
                         or any(a.endMs > b.startMs for a, b in zip(segments, segments[1:]))):
            raise ValueError('Source segments must be ordered within the clip boundaries and cannot overlap')
        if any(c.endMs > self.duration_ms for c in self.captions):
            raise ValueError('Caption exceeds clip duration')
        if self.framingKeyframes and self.framingKeyframes[-1].timeMs > self.duration_ms:
            raise ValueError('Framing keyframe exceeds clip duration')
        if any(a.timeMs >= b.timeMs for a, b in zip(self.framingKeyframes, self.framingKeyframes[1:])):
            raise ValueError('Framing keyframe times must be strictly increasing')
        return self

    @property
    def duration_ms(self):
        if self.sourceSegments:
            return sum(segment.endMs - segment.startMs for segment in self.sourceSegments)
        return self.sourceOutMs - self.sourceInMs

    @property
    def duration(self):
        return self.duration_ms / 1000

    @property
    def dimensions(self):
        a, b = map(int, self.ratio.split(':'))
        width = int(self.resolution)
        return width, round(width*b/a/2)*2


class ProjectInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    title: str = Field(min_length=1, max_length=180)
    category: str = 'Personal'
    folder: str = ''
    favorite: bool = False
    archived: bool = False
    permissionNotes: str = Field(default='', max_length=4000)
    preferences: dict[str, str] = Field(default_factory=dict)


class ClipInput(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    edit: EditDocument
    favorite: bool = False
    status: Literal['draft', 'saved', 'rejected'] = 'draft'
    notes: str = Field(default='', max_length=4000)


class Submission(BaseModel):
    clipId: str
    url: str = Field(default='', max_length=2000)
    status: str = 'draft'
    views: int = Field(default=0, ge=0)
    payout: float = Field(default=0, ge=0)


class CampaignInput(BaseModel):
    title: str = Field(min_length=1, max_length=180)
    platform: str = 'Instagram Reels'
    permissionNotes: str = ''
    minSeconds: float = Field(default=0, ge=0)
    maxSeconds: float = Field(default=60, gt=0)
    ratio: Literal['9:16', '4:5', '1:1', '16:9'] = '9:16'
    branding: str = ''
    disclaimer: str = ''
    dueAt: str = ''
    clipIds: list[str] = Field(default_factory=list)
    submissions: list[Submission] = Field(default_factory=list)

    @model_validator(mode='after')
    def valid_limits(self):
        if self.maxSeconds < self.minSeconds:
            raise ValueError('Maximum duration must follow minimum')
        return self
