import { handleGetTodayEvents } from '../intents/getTodayEvents';
import { voiceClient, VoiceApiError } from '../client';

jest.mock('../client', () => {
  const actual = jest.requireActual('../client');
  return {
    ...actual,
    voiceClient: {
      getCalendarToday: jest.fn(),
    },
  };
});

const mockedClient = voiceClient as jest.Mocked<typeof voiceClient>;

describe('handleGetTodayEvents', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the spoken string from the Voice API', async () => {
    mockedClient.getCalendarToday.mockResolvedValue({
      ok: true,
      spoken: 'Today you have Soccer at 4 PM.',
      data: { count: 1, events: [] },
    });

    const res = await handleGetTodayEvents();
    expect(res.response.outputSpeech.text).toBe('Today you have Soccer at 4 PM.');
    expect(res.response.shouldEndSession).toBe(true);
  });

  it('returns an apology when the upstream API fails', async () => {
    mockedClient.getCalendarToday.mockRejectedValue(new VoiceApiError(503, { error: 'down' }));

    const res = await handleGetTodayEvents();
    expect(res.response.outputSpeech.text).toMatch(/couldn't reach kyst/i);
  });

  it('rethrows non-VoiceApiError exceptions', async () => {
    const boom = new Error('unexpected');
    mockedClient.getCalendarToday.mockRejectedValue(boom);

    await expect(handleGetTodayEvents()).rejects.toBe(boom);
  });
});
