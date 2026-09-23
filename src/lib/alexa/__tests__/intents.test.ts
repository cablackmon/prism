import { handleAddShoppingItem } from '../intents/addShoppingItem';
import { handleCompleteChore } from '../intents/completeChore';
import { handlePostFamilyMessage } from '../intents/postFamilyMessage';
import { handleGetUpcomingEvents } from '../intents/getUpcomingEvents';
import { handleGetTodayChores } from '../intents/getTodayChores';
import { handleGetBusStatus } from '../intents/getBusStatus';
import { voiceClient, VoiceApiError } from '../client';

jest.mock('../client', () => {
  const actual = jest.requireActual('../client');
  return {
    ...actual,
    voiceClient: {
      getCalendarToday: jest.fn(),
      getCalendarUpcoming: jest.fn(),
      getTasksToday: jest.fn(),
      getRecentMessages: jest.fn(),
      postShoppingItem: jest.fn(),
      completeChore: jest.fn(),
      postFamilyMessage: jest.fn(),
      getFamily: jest.fn(),
      getMealsToday: jest.fn(),
      getChoresToday: jest.fn(),
      getWeatherToday: jest.fn(),
      getBusStatus: jest.fn(),
      getUpcomingBirthdays: jest.fn(),
    },
  };
});

const mocked = voiceClient as jest.Mocked<typeof voiceClient>;

beforeEach(() => jest.clearAllMocks());

describe('AddShoppingItemIntent slot handling', () => {
  it('asks for the item when slot is empty', async () => {
    const res = await handleAddShoppingItem({ slots: {} });
    expect(res.response.outputSpeech.text).toMatch(/what item/i);
    expect(mocked.postShoppingItem).not.toHaveBeenCalled();
  });

  it('passes item and optional list to the Voice API', async () => {
    mocked.postShoppingItem.mockResolvedValue({ ok: true, spoken: 'Added milk to Grocery.' });
    await handleAddShoppingItem({
      slots: { Item: { value: 'milk' }, ListName: { value: 'grocery' } },
    });
    expect(mocked.postShoppingItem).toHaveBeenCalledWith({ item: 'milk', list: 'grocery' });
  });

  it('omits list when ListName slot is empty', async () => {
    mocked.postShoppingItem.mockResolvedValue({ ok: true, spoken: 'Added milk.' });
    await handleAddShoppingItem({ slots: { Item: { value: 'milk' } } });
    expect(mocked.postShoppingItem).toHaveBeenCalledWith({ item: 'milk', list: undefined });
  });

  it('apologizes on Voice API failure', async () => {
    mocked.postShoppingItem.mockRejectedValue(new VoiceApiError(500, null));
    const res = await handleAddShoppingItem({ slots: { Item: { value: 'milk' } } });
    expect(res.response.outputSpeech.text).toMatch(/couldn't add/i);
  });
});

describe('CompleteChoreIntent slot handling', () => {
  it('asks for the chore when slot is empty', async () => {
    const res = await handleCompleteChore({ slots: {} });
    expect(res.response.outputSpeech.text).toMatch(/which chore/i);
    expect(mocked.completeChore).not.toHaveBeenCalled();
  });

  it('forwards chore name and optional assignee', async () => {
    mocked.completeChore.mockResolvedValue({ ok: true, spoken: 'Marked feed the dog complete.' });
    await handleCompleteChore({
      slots: { Chore: { value: 'feed the dog' }, Assignee: { value: 'Emma' } },
    });
    expect(mocked.completeChore).toHaveBeenCalledWith({ chore: 'feed the dog', assignee: 'Emma' });
  });

  it('passes back the disambiguation prompt unchanged', async () => {
    mocked.completeChore.mockResolvedValue({
      ok: false,
      spoken: "Multiple chores match 'feed the dog'. Which family member?",
      data: { candidates: [{ title: 'Feed the dog', assignee: 'Emma' }] },
    });
    const res = await handleCompleteChore({ slots: { Chore: { value: 'feed the dog' } } });
    expect(res.response.outputSpeech.text).toMatch(/multiple chores/i);
  });
});

describe('PostFamilyMessageIntent slot handling', () => {
  it('asks for the message when slot is empty', async () => {
    const res = await handlePostFamilyMessage({ slots: {} });
    expect(res.response.outputSpeech.text).toMatch(/what message/i);
    expect(mocked.postFamilyMessage).not.toHaveBeenCalled();
  });

  it('forwards the message body', async () => {
    mocked.postFamilyMessage.mockResolvedValue({ ok: true, spoken: 'Posted message.' });
    await handlePostFamilyMessage({ slots: { Message: { value: 'soccer at 4' } } });
    expect(mocked.postFamilyMessage).toHaveBeenCalledWith({ message: 'soccer at 4' });
  });
});

describe('GetTodayChoresIntent slot handling', () => {
  it('forwards optional assignee', async () => {
    mocked.getChoresToday.mockResolvedValue({ ok: true, spoken: 'Emma has 1 chore today.' });
    await handleGetTodayChores({ slots: { Assignee: { value: 'Emma' } } });
    expect(mocked.getChoresToday).toHaveBeenCalledWith('Emma');
  });

  it('omits assignee when missing', async () => {
    mocked.getChoresToday.mockResolvedValue({ ok: true, spoken: 'No chores today.' });
    await handleGetTodayChores({ slots: {} });
    expect(mocked.getChoresToday).toHaveBeenCalledWith(undefined);
  });
});

describe('GetBusStatusIntent slot handling', () => {
  it('forwards optional student', async () => {
    mocked.getBusStatus.mockResolvedValue({ ok: true, spoken: 'Emma AM: 5 minutes away.' });
    await handleGetBusStatus({ slots: { Student: { value: 'Emma' } } });
    expect(mocked.getBusStatus).toHaveBeenCalledWith('Emma');
  });

  it('omits student when missing', async () => {
    mocked.getBusStatus.mockResolvedValue({ ok: true, spoken: 'No routes today.' });
    await handleGetBusStatus({ slots: {} });
    expect(mocked.getBusStatus).toHaveBeenCalledWith(undefined);
  });

  it('apologizes on failure', async () => {
    mocked.getBusStatus.mockRejectedValue(new VoiceApiError(503, null));
    const res = await handleGetBusStatus({ slots: {} });
    expect(res.response.outputSpeech.text).toMatch(/couldn't reach the bus/i);
  });
});

describe('GetUpcomingEventsIntent count handling', () => {
  it('uses default 3 when count slot is missing', async () => {
    mocked.getCalendarUpcoming.mockResolvedValue({ ok: true, spoken: 'Coming up: ...' });
    await handleGetUpcomingEvents({ slots: {} });
    expect(mocked.getCalendarUpcoming).toHaveBeenCalledWith(3);
  });

  it('clamps count to 1..10', async () => {
    mocked.getCalendarUpcoming.mockResolvedValue({ ok: true, spoken: 'Coming up: ...' });
    await handleGetUpcomingEvents({ slots: { Count: { value: '50' } } });
    expect(mocked.getCalendarUpcoming).toHaveBeenCalledWith(10);

    await handleGetUpcomingEvents({ slots: { Count: { value: '0' } } });
    expect(mocked.getCalendarUpcoming).toHaveBeenCalledWith(1);
  });

  it('forwards a valid count', async () => {
    mocked.getCalendarUpcoming.mockResolvedValue({ ok: true, spoken: 'Coming up: ...' });
    await handleGetUpcomingEvents({ slots: { Count: { value: '5' } } });
    expect(mocked.getCalendarUpcoming).toHaveBeenCalledWith(5);
  });
});
