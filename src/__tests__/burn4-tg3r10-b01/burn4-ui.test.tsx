import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import RecipeReadPage from '../../app/recipes/read/page';
import { RecipeReader } from '../../components/recipes/burn4-recipe-reader';
import { deferred, firstId, recipe, response, secondId } from './burn4-fixtures';

let fetchMock: jest.Mock;
const index = () => response({ recipes: [recipe(), recipe(secondId, 'Sample toast')], total: 2 });

beforeEach(() => {
  window.history.replaceState(null, '', '/recipes/read');
  fetchMock = jest.fn(async (url: string) => url.includes('?') ? index() : response(recipe(url.split('/').pop())));
  Object.defineProperty(globalThis, 'fetch', { value: fetchMock, writable: true, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: jest.fn(async () => undefined) }, configurable: true });
  jest.spyOn(window, 'print').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

async function openRecipe(id = firstId) {
  window.history.replaceState(null, '', `/recipes/read?id=${id}`);
  const view = render(<RecipeReader />);
  await screen.findByRole('article', { name: 'Recipe' });
  return view;
}

test('the actual route renders its saved recipe selector and read-only scope', async () => {
  render(<RecipeReadPage />);
  expect(await screen.findByRole('option', { name: 'Sample soup' })).toBeTruthy();
  expect(screen.getByText(/links require household sign-in/)).toBeTruthy();
  expect(screen.getByRole('link', { name: 'Recipe library' }).getAttribute('href')).toBe('/recipes');
  expect(screen.getByRole('button', { name: 'Print recipe' })).toHaveProperty('disabled', true);
});

test('deep link displays only allowed escaped text, ingredient order and line breaks', async () => {
  fetchMock.mockImplementation(async (url: string) => url.includes('?') ? index() : response({ ...recipe(), name: '<img src=x onerror=alert(1)>', notes: 'Private note', createdByName: 'Private author', imageUrl: 'https://external.test/photo' }));
  await openRecipe();
  const article = screen.getByRole('article');
  expect(within(article).getByRole('heading', { level: 2 }).textContent).toContain('<img src=x onerror=alert(1)>');
  expect(article.querySelector('img')).toBeNull();
  expect(article.textContent).not.toContain('Private note');
  expect(article.textContent).not.toContain('Private author');
  expect(within(article).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Soup', '2 cups water']);
  expect(within(article).getByText('Boil. Serve.').textContent).toBe('Boil.\nServe.');
  expect(article.textContent).toContain('0 minutes');
  expect(article.querySelectorAll('button,input,a')).toHaveLength(0);
});

test('selecting an indexed recipe changes URL and loads only GET data', async () => {
  render(<RecipeReader />);
  await screen.findByRole('option', { name: 'Sample soup' });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: firstId } });
  await screen.findByRole('article');
  expect(window.location.search).toBe(`?id=${firstId}`);
  expect(fetchMock.mock.calls.every((call) => call[1].method === 'GET')).toBe(true);
});

test.each(['bad', `${firstId}&id=${secondId}`])('malformed or repeated query id %s performs no detail fetch', async (id) => {
  window.history.replaceState(null, '', `/recipes/read?id=${id}`);
  render(<RecipeReader />);
  expect(await screen.findByText('This recipe link is invalid. Choose a saved recipe.')).toBeTruthy();
  expect(fetchMock.mock.calls.every((call) => call[0].includes('?'))).toBe(true);
});

test('supports selected recipe outside the current index page', async () => {
  fetchMock.mockImplementation(async (url: string) => url.includes('?') ? response({ recipes: [], total: 0 }) : response(recipe()));
  await openRecipe();
  expect(screen.getByRole('combobox')).toHaveProperty('value', firstId);
  expect(screen.getByText('No saved recipes on this page. Sign in or open a recipe link.')).toBeTruthy();
});

test.each([[401, 'Sign in to Prism'], [403, 'Your session cannot read'], [404, 'Recipe not found'], [500, 'Could not load recipes']])('detail status %i clears printable content and exposes retry', async (status, message) => {
  fetchMock.mockImplementation(async (url: string) => url.includes('?') ? index() : response({}, status as number));
  window.history.replaceState(null, '', `/recipes/read?id=${firstId}`);
  render(<RecipeReader />);
  expect(await screen.findByText(new RegExp(message as string))).toBeTruthy();
  expect(screen.queryByRole('article')).toBeNull();
  expect(screen.getByRole('button', { name: 'Print recipe' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('button', { name: 'Retry recipe' })).toBeTruthy();
});

test('retry replaces an error with a new recipe request', async () => {
  let detailCalls = 0;
  fetchMock.mockImplementation(async (url: string) => url.includes('?') ? index() : ++detailCalls === 1 ? response({}, 500) : response(recipe()));
  window.history.replaceState(null, '', `/recipes/read?id=${firstId}`);
  render(<RecipeReader />);
  fireEvent.click(await screen.findByRole('button', { name: 'Retry recipe' }));
  await screen.findByRole('article');
  expect(detailCalls).toBe(2);
  expect(screen.queryByRole('alert')).toBeNull();
});

test('malformed detail data is never rendered', async () => {
  fetchMock.mockImplementation(async (url: string) => url.includes('?') ? index() : response({ ...recipe(), ingredients: [{ amount: '2' }] }));
  window.history.replaceState(null, '', `/recipes/read?id=${firstId}`);
  render(<RecipeReader />);
  expect((await screen.findByRole('alert')).textContent).toContain('Recipe text is missing or too long.');
  expect(screen.queryByRole('article')).toBeNull();
});

test('index error can retry without blocking a direct link', async () => {
  let listCalls = 0;
  fetchMock.mockImplementation(async (url: string) => url.includes('?') ? ++listCalls === 1 ? response({}, 500) : index() : response(recipe()));
  await openRecipe();
  fireEvent.click(await screen.findByRole('button', { name: 'Retry saved recipes' }));
  await screen.findByRole('option', { name: 'Sample toast' });
  expect(listCalls).toBe(2);
  expect(screen.getByRole('article')).toBeTruthy();
});

test('index paging keeps bounded offsets and the selected detail', async () => {
  fetchMock.mockImplementation(async (url: string) => url.includes('offset=100') ? response({ recipes: [recipe(secondId, 'Next page')], total: 101 }) : url.includes('?') ? response({ recipes: [recipe()], total: 101 }) : response(recipe()));
  await openRecipe();
  fireEvent.click(screen.getByRole('button', { name: 'Next recipe page' }));
  await screen.findByRole('option', { name: 'Next page' });
  expect(screen.getByRole('button', { name: 'Next recipe page' })).toHaveProperty('disabled', true);
  expect(screen.getByRole('article')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Previous recipe page' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Previous recipe page' })).toHaveProperty('disabled', true));
});

test('old detail responses cannot replace the newly selected recipe', async () => {
  const old = deferred<Response>();
  fetchMock.mockImplementation((url: string) => url.includes('?') ? Promise.resolve(index()) : url.endsWith(firstId) ? old.promise : Promise.resolve(response(recipe(secondId, 'New selection'))));
  window.history.replaceState(null, '', `/recipes/read?id=${firstId}`);
  render(<RecipeReader />);
  await screen.findByRole('option', { name: 'Sample toast' });
  const oldSignal = fetchMock.mock.calls.find((call) => call[0].endsWith(firstId))![1].signal as AbortSignal;
  fireEvent.change(screen.getByRole('combobox'), { target: { value: secondId } });
  expect(screen.queryByRole('article')).toBeNull();
  expect(oldSignal.aborted).toBe(true);
  await screen.findByRole('heading', { name: 'New selection' });
  await act(async () => { old.resolve(response(recipe(firstId, 'Old result'))); });
  expect(screen.queryByText('Old result')).toBeNull();
});

test('popstate clears the previous recipe immediately and handles empty selection', async () => {
  await openRecipe();
  window.history.replaceState(null, '', '/recipes/read');
  fireEvent.popState(window);
  expect(screen.queryByRole('article')).toBeNull();
  expect(screen.getByRole('button', { name: 'Print recipe' })).toHaveProperty('disabled', true);
});

test('unmount aborts both in-flight requests and fences late completion', async () => {
  const pending = deferred<Response>();
  fetchMock.mockReturnValue(pending.promise);
  window.history.replaceState(null, '', `/recipes/read?id=${firstId}`);
  const view = render(<RecipeReader />);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  const signals = fetchMock.mock.calls.map((call) => call[1].signal as AbortSignal);
  view.unmount();
  expect(signals.every((signal) => signal.aborted)).toBe(true);
  await act(async () => { pending.resolve(response(recipe())); });
});

test('copy requires an explicit gesture and produces only the canonical household link', async () => {
  await openRecipe();
  expect(navigator.clipboard.writeText).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Copy read-only link' }));
  expect(await screen.findByText('Recipe link copied. Household sign-in is required.')).toBeTruthy();
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith(`http://localhost/recipes/read?id=${firstId}`);
});

test.each(['missing', 'reject'])('copy %s capability reports an actionable failure', async (mode) => {
  Object.defineProperty(navigator, 'clipboard', { value: mode === 'missing' ? undefined : { writeText: jest.fn(async () => { throw new Error('denied'); }) }, configurable: true });
  await openRecipe();
  fireEvent.click(screen.getByRole('button', { name: 'Copy read-only link' }));
  expect(await screen.findByText(/Could not copy the link/)).toBeTruthy();
});

test('late copy completion is fenced after changing selection', async () => {
  const copy = deferred<void>();
  jest.spyOn(navigator.clipboard, 'writeText').mockReturnValue(copy.promise);
  await openRecipe();
  fireEvent.click(screen.getByRole('button', { name: 'Copy read-only link' }));
  fireEvent.change(screen.getByRole('combobox'), { target: { value: secondId } });
  await act(async () => { copy.resolve(); });
  expect(screen.queryByText(/Recipe link copied/)).toBeNull();
});

test('late copy completion is fenced after unmount', async () => {
  const copy = deferred<void>();
  jest.spyOn(navigator.clipboard, 'writeText').mockReturnValue(copy.promise);
  const view = await openRecipe();
  fireEvent.click(screen.getByRole('button', { name: 'Copy read-only link' }));
  view.unmount();
  await act(async () => { copy.resolve(); });
  expect(screen.queryByText(/Recipe link copied/)).toBeNull();
});

test('printing requires a gesture and reports a request rather than completion', async () => {
  await openRecipe();
  expect(window.print).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Print recipe' }));
  expect(window.print).toHaveBeenCalledTimes(1);
  expect(screen.getByText('Print requested. Use the browser dialog to finish.')).toBeTruthy();
});

test('print failure is recoverable', async () => {
  jest.spyOn(window, 'print').mockImplementation(() => { throw new Error('unavailable'); });
  await openRecipe();
  fireEvent.click(screen.getByRole('button', { name: 'Print recipe' }));
  expect(screen.getByText('Printing is unavailable. Try your browser print command.')).toBeTruthy();
});

test('a beforeprint navigation cannot leave a success notice for a different selection', async () => {
  jest.spyOn(window, 'print').mockImplementation(() => {
    window.history.replaceState(null, '', '/recipes/read');
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  await openRecipe();
  fireEvent.click(screen.getByRole('button', { name: 'Print recipe' }));
  expect(screen.queryByRole('article')).toBeNull();
  expect(screen.queryByText(/Print requested/)).toBeNull();
});

test('history write failure preserves the currently selected recipe', async () => {
  await openRecipe();
  jest.spyOn(window.history, 'pushState').mockImplementation(() => { throw new Error('blocked'); });
  fireEvent.change(screen.getByRole('combobox'), { target: { value: secondId } });
  expect(screen.getByText('This browser could not update the recipe link.')).toBeTruthy();
  expect(screen.getByRole('combobox')).toHaveProperty('value', firstId);
  expect(screen.getByRole('article')).toBeTruthy();
});

test('independent reader instances have distinct accessible selector labels', async () => {
  const view = render(<><RecipeReader /><RecipeReader /></>);
  await waitFor(() => expect(screen.getAllByRole('option', { name: 'Sample toast' })).toHaveLength(2));
  const selects = screen.getAllByRole('combobox');
  expect(selects[0]!.id).not.toBe(selects[1]!.id);
  view.unmount();
});

test('print stylesheet scopes broad shell suppression to a mounted recipe reader', () => {
  const css = readFileSync(path.join(__dirname, '../../app/recipes/read/burn4-print.css'), 'utf8');
  expect(css).toContain('@media print');
  expect(css).toContain('body:has([data-burn4-recipe-reader]) { overflow: visible !important');
  expect(css).toContain(':not([data-burn4-recipe-reader] *) { display: none !important; }');
  expect(css).toContain('[data-burn4-recipe-reader] [data-burn4-reader-controls] { display: none !important; }');
  expect(css).not.toMatch(/body\s+\*/);
});
