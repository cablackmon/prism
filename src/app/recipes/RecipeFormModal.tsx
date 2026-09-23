'use client';

import { useRef, useState } from 'react';
import { Camera, Trash2 } from 'lucide-react';
import { toast } from '@/components/ui/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { Recipe } from '@/lib/hooks/useRecipes';

export interface RecipeFormModalProps {
  recipe?: Recipe;
  onClose: () => void;
  onSave: (data: {
    name: string;
    description?: string;
    ingredients?: Array<{ text?: string; heading?: string }>;
    instructions?: string;
    prepTime?: number;
    cookTime?: number;
    servings?: number;
    cuisine?: string;
    category?: string;
    imageUrl?: string;
    notes?: string;
  }) => Promise<void>;
}

export function RecipeFormModal({ recipe, onClose, onSave }: RecipeFormModalProps) {
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(recipe?.name || '');
  const [description, setDescription] = useState(recipe?.description || '');
  // Serialize headings as "Heading:" with a blank line before each section
  // so the textarea round-trips cleanly. Text-only entries stay as-is.
  const [ingredientsText, setIngredientsText] = useState(() => {
    if (!recipe?.ingredients) return '';
    const lines: string[] = [];
    for (let i = 0; i < recipe.ingredients.length; i++) {
      const ing = recipe.ingredients[i]!;
      if (ing.heading) {
        if (lines.length > 0) lines.push('');
        lines.push(`${ing.heading}:`);
      } else if (ing.text) {
        lines.push(ing.text);
      }
    }
    return lines.join('\n');
  });
  const [instructions, setInstructions] = useState(recipe?.instructions || '');
  const [prepTime, setPrepTime] = useState(recipe?.prepTime?.toString() || '');
  const [cookTime, setCookTime] = useState(recipe?.cookTime?.toString() || '');
  const [servings, setServings] = useState(recipe?.servings?.toString() || '');
  const [cuisine, setCuisine] = useState(recipe?.cuisine || '');
  const [category, setCategory] = useState(recipe?.category || '');
  const [imageUrl, setImageUrl] = useState(recipe?.imageUrl || '');
  const [notes, setNotes] = useState(recipe?.notes || '');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const recipeId = recipe?.id;

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset input so re-selecting the same file fires onChange again.
    if (fileInputRef.current) fileInputRef.current.value = '';
    if (!file || !recipeId) return;

    if (file.size > 10 * 1024 * 1024) {
      toast({ title: 'Image too large (max 10MB)', variant: 'destructive' });
      return;
    }

    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`/api/recipes/${recipeId}/image`, {
        method: 'POST',
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Upload failed');
      }
      const { imageUrl: newUrl } = await res.json();
      setImageUrl(newUrl);
      toast({ title: 'Photo added' });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : 'Failed to upload photo',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleRemovePhoto = async () => {
    if (!recipeId) {
      setImageUrl('');
      return;
    }
    setUploading(true);
    try {
      const res = await fetch(`/api/recipes/${recipeId}/image`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setImageUrl('');
    } catch (err) {
      toast({
        title:
          err instanceof Error
            ? `Failed to remove photo: ${err.message}`
            : 'Failed to remove photo',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast({ title: 'Recipe name is required', variant: 'warning' });
      return;
    }

    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        description: description.trim() || undefined,
        ingredients: ingredientsText
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0)
          .map((line) => {
            // Trailing-colon (and short, non-numeric) → section heading.
            if (/^[^\d¼½¾⅓⅔⅛⅜⅝⅞].{0,49}:\s*$/.test(line)) {
              return { heading: line.replace(/[:.]+\s*$/, '').trim() };
            }
            return { text: line };
          }),
        instructions: instructions.trim() || undefined,
        prepTime: prepTime ? parseInt(prepTime, 10) : undefined,
        cookTime: cookTime ? parseInt(cookTime, 10) : undefined,
        servings: servings ? parseInt(servings, 10) : undefined,
        cuisine: cuisine.trim() || undefined,
        category: category.trim() || undefined,
        imageUrl: imageUrl.trim() || undefined,
        notes: notes.trim() || undefined,
      });
    } catch (err) {
      toast({
        title: err instanceof Error ? err.message : 'Failed to save recipe',
        variant: 'destructive',
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{recipe?.id ? 'Edit Recipe' : 'Add Recipe'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-2">
            <Label htmlFor="name">Recipe Name *</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Chicken Parmesan"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description..."
            />
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="prepTime">Prep Time (min)</Label>
              <Input
                id="prepTime"
                type="number"
                value={prepTime}
                onChange={(e) => setPrepTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cookTime">Cook Time (min)</Label>
              <Input
                id="cookTime"
                type="number"
                value={cookTime}
                onChange={(e) => setCookTime(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="servings">Servings</Label>
              <Input
                id="servings"
                type="number"
                value={servings}
                onChange={(e) => setServings(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="cuisine">Cuisine</Label>
              <Input
                id="cuisine"
                value={cuisine}
                onChange={(e) => setCuisine(e.target.value)}
                placeholder="e.g., Italian"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="category">Category</Label>
              <Input
                id="category"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g., Main Dish"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="ingredients">
              Ingredients (one per line; end a line with &quot;:&quot; for a section)
            </Label>
            <Textarea
              id="ingredients"
              value={ingredientsText}
              onChange={(e) => setIngredientsText(e.target.value)}
              placeholder={
                'Fries:\n4 potatoes\n2 tbsp olive oil\n\nMeatballs:\n1 lb ground beef\n1 egg'
              }
              rows={8}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="instructions">Instructions</Label>
            <Textarea
              id="instructions"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder="Step-by-step instructions..."
              rows={6}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="imageUrl">Photo</Label>
            {imageUrl && (
              <div className="relative w-full max-w-xs">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt="Recipe"
                  className="h-40 w-full rounded border border-border object-cover"
                />
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={handleFileSelected}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!recipeId || uploading}
                onClick={() => fileInputRef.current?.click()}
              >
                <Camera className="mr-1 h-4 w-4" />
                {uploading ? 'Uploading...' : imageUrl ? 'Replace photo' : 'Upload photo'}
              </Button>
              {imageUrl && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={uploading}
                  onClick={handleRemovePhoto}
                >
                  <Trash2 className="mr-1 h-4 w-4" />
                  Remove
                </Button>
              )}
            </div>
            {!recipeId && (
              <p className="text-xs text-muted-foreground">
                Save the recipe first, then reopen to upload a photo from your device.
              </p>
            )}
            <Input
              id="imageUrl"
              value={imageUrl}
              onChange={(e) => setImageUrl(e.target.value)}
              placeholder="…or paste an image URL"
              className="text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Personal notes, tips, variations..."
              rows={3}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : recipe?.id ? 'Save Changes' : 'Add Recipe'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
