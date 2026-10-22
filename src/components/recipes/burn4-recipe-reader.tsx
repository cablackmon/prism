'use client';

import { useEffect, useId, useRef, useState } from 'react';
import {
  loadReaderIndex, loadReaderRecipe, parseRecipeId, recipeReaderUrl,
  type ReaderIndex, type ReaderRecipe,
} from '../../lib/burn4-recipe-reader';

type Detail = { key: string; recipe?: ReaderRecipe; error?: string };
type Index = { offset: number; value?: ReaderIndex; error?: string };

function locationId(): string {
  const values = new URLSearchParams(window.location.search).getAll('id');
  return values.length === 0 ? '' : values.length === 1 ? values[0]! : 'invalid';
}

export function RecipeReader() {
  const choiceId = useId();
  const [id, setId] = useState('');
  const [ready, setReady] = useState(false);
  const [retry, setRetry] = useState(0);
  const [detail, setDetail] = useState<Detail>({ key: '' });
  const [offset, setOffset] = useState(0);
  const [indexRetry, setIndexRetry] = useState(0);
  const [index, setIndex] = useState<Index>({ offset: 0 });
  const [notice, setNotice] = useState('');
  const operation = useRef(0);
  const parsedId = parseRecipeId(id);
  const detailKey = `${id}:${retry}`;
  const current = detail.key === detailKey ? detail : undefined;
  const recipe = current?.recipe;
  const currentIndex = index.offset === offset ? index : undefined;

  useEffect(() => {
    const update = () => { operation.current++; setNotice(''); setId(locationId()); };
    update();
    setReady(true);
    window.addEventListener('popstate', update);
    return () => { operation.current++; window.removeEventListener('popstate', update); };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let live = true;
    const controller = new AbortController();
    setIndex({ offset });
    void loadReaderIndex(offset, controller.signal).then(
      (value) => { if (live) setIndex({ offset, value }); },
      (error: unknown) => { if (live) setIndex({ offset, error: error instanceof Error ? error.message : 'Could not load recipes.' }); },
    );
    return () => { live = false; controller.abort(); };
  }, [ready, offset, indexRetry]);

  useEffect(() => {
    operation.current++;
    setNotice('');
    if (!ready || !parsedId) return;
    let live = true;
    const controller = new AbortController();
    void loadReaderRecipe(parsedId, controller.signal).then(
      (value) => { if (live) setDetail({ key: detailKey, recipe: value }); },
      (error: unknown) => { if (live) setDetail({ key: detailKey, error: error instanceof Error ? error.message : 'Could not load this recipe.' }); },
    );
    return () => { live = false; controller.abort(); };
  }, [ready, parsedId, detailKey]);

  const select = (nextId: string) => {
    operation.current++;
    setNotice('');
    const next = new URL(window.location.href);
    next.search = nextId ? `?id=${encodeURIComponent(nextId)}` : '';
    next.hash = '';
    try { window.history.pushState(null, '', `${next.pathname}${next.search}`); }
    catch { setNotice('This browser could not update the recipe link.'); return; }
    setId(nextId);
  };

  const copy = async () => {
    if (!recipe) return;
    const attempt = ++operation.current;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('unavailable');
      await navigator.clipboard.writeText(recipeReaderUrl(window.location.origin, recipe.id));
      if (attempt === operation.current) setNotice('Recipe link copied. Household sign-in is required.');
    } catch {
      if (attempt === operation.current) setNotice('Could not copy the link. Copy this page address from your browser.');
    }
  };

  const print = () => {
    if (!recipe) return;
    const attempt = ++operation.current;
    try {
      if (typeof window.print !== 'function') throw new Error('unavailable');
      window.print();
      if (attempt === operation.current) setNotice('Print requested. Use the browser dialog to finish.');
    } catch {
      if (attempt === operation.current) setNotice('Printing is unavailable. Try your browser print command.');
    }
  };

  return (
    <main data-burn4-recipe-reader className="burn4-reader">
      <div data-burn4-reader-controls>
        <a href="/recipes">Recipe library</a>
        <h1>Read and print a recipe</h1>
        <p>Read-only recipe links require household sign-in. Recipe changes are made in the recipe library.</p>
        <label htmlFor={choiceId}>Saved recipe</label>
        <select id={choiceId} value={parsedId ?? ''} onChange={(event) => select(event.target.value)}>
          <option value="">Choose a recipe</option>
          {parsedId && !currentIndex?.value?.recipes.some((row) => row.id === parsedId) &&
            <option value={parsedId}>{recipe?.name ?? 'Linked recipe'}</option>}
          {currentIndex?.value?.recipes.map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
        </select>
        {!currentIndex?.value && !currentIndex?.error && <p role="status">Loading saved recipes...</p>}
        {currentIndex?.error && <div role="alert"><p>{currentIndex.error}</p><button onClick={() => setIndexRetry((value) => value + 1)}>Retry saved recipes</button></div>}
        {currentIndex?.value && <>
          {currentIndex.value.recipes.length === 0 && <p>No saved recipes on this page. Sign in or open a recipe link.</p>}
          <button disabled={offset === 0} onClick={() => setOffset((value) => Math.max(0, value - 100))}>Previous recipe page</button>
          <button disabled={offset + 100 >= currentIndex.value.total || offset >= 100000 || currentIndex.value.recipes.length === 0} onClick={() => setOffset((value) => value + 100)}>Next recipe page</button>
        </>}
        {ready && id && !parsedId && <p role="alert">This recipe link is invalid. Choose a saved recipe.</p>}
        {ready && parsedId && !recipe && !current?.error && <p role="status">Loading recipe...</p>}
        {current?.error && <div role="alert"><p>{current.error}</p><button onClick={() => setRetry((value) => value + 1)}>Retry recipe</button></div>}
        <button disabled={!recipe} onClick={() => void copy()}>Copy read-only link</button>
        <button disabled={!recipe} onClick={print}>Print recipe</button>
        <p role="status" aria-live="polite">{notice}</p>
      </div>
      {recipe && <article data-burn4-recipe-content aria-label="Recipe">
        <h2>{recipe.name}</h2>
        {recipe.description && <p className="burn4-reader-lines">{recipe.description}</p>}
        <dl>
          {recipe.prepTime !== null && <><dt>Prep time</dt><dd>{recipe.prepTime} minutes</dd></>}
          {recipe.cookTime !== null && <><dt>Cook time</dt><dd>{recipe.cookTime} minutes</dd></>}
          {recipe.servings !== null && <><dt>Servings</dt><dd>{recipe.servings}</dd></>}
          {recipe.cuisine && <><dt>Cuisine</dt><dd>{recipe.cuisine}</dd></>}
          {recipe.category && <><dt>Category</dt><dd>{recipe.category}</dd></>}
        </dl>
        <h3>Ingredients</h3>
        {recipe.ingredients.length === 0 ? <p>No ingredients recorded.</p> : <ul>
          {recipe.ingredients.map((item, position) => <li key={position}>{'heading' in item ? <h4>{item.heading}</h4> : item.text}</li>)}
        </ul>}
        <h3>Instructions</h3>
        <p className="burn4-reader-lines">{recipe.instructions ?? 'No instructions recorded.'}</p>
      </article>}
    </main>
  );
}
