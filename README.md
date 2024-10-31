# Claude usage counter

Available on [Greasy Fork](https://greasyfork.org/en/scripts/515111-claude-usage-tracker)

This is basically a script meant to help you gauge how much usage of claude you have left.

It's still WIP, so the numbers for the caps of each model are mostly just guesses.
If you find that your experience doesn't match my guesses, let me know in the issues, and I'll update it!

The script will correctly handle calculating token usage from:
- Files uploaded to the chat
- Project knowledge files (So long as you let the page fully load, the project stuff can take an extra few seconds)
- Message history
- The AI's output (This is weighted as being 10x the usage of input tokens, based on the API pricing)

(And yes, this was mostly coded using Sonnet 3.5)
