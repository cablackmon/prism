'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { parseRecipeText, type ParsedRecipeText } from '@/lib/utils/recipeTextParser';

export interface ImportTextModalProps {
  onClose: () => void;
  onParsed: (parsed: ParsedRecipeText) => void;
}

export function ImportTextModal({ onClose, onParsed }: ImportTextModalProps) {
  const [text, setText] = useState('');

  const handleParse = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onParsed(parseRecipeText(trimmed));
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Paste Recipe Text</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground">
            Paste OCR&apos;d text from a recipe photo (iOS Live Text, Google Lens, etc.).
            KYST will split it into title, ingredients, and instructions for you to
            review before saving.
          </p>

          <div className="space-y-2">
            <Label htmlFor="recipe-text" className="sr-only">Recipe text</Label>
            <Textarea
              id="recipe-text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={
                'Mom\'s Banana Bread\n\nPrep: 15 min\nCook: 1 hour\nServes: 8\n\nIngredients\n2 ripe bananas\n1/2 cup sugar\n1 1/2 cups flour\n\nInstructions\n1. Preheat oven to 350°F.\n2. Mash bananas, mix in sugar and flour.\n3. Bake for 1 hour.'
              }
              autoFocus
              rows={14}
              className="font-mono text-sm max-h-[50vh]"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={handleParse} disabled={!text.trim()}>
            Parse &amp; Review
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
