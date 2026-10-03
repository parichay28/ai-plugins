# image-preview

See the images in your prompt before you send it. This Claude Code mod puts a small thumbnail of each image right above the prompt box, and you can click one to see it full size.

## Why

When you paste an image into Claude Code, the prompt box just shows `[Image #3]`. That's fine for one image. Once you have three or four, or you press up to reuse an old prompt, you have no idea which picture is which until Claude has already read them.

## What you need

- **A terminal that can draw images**, like Ghostty or kitty. The thumbnails use the terminal's image protocol, so plain terminals won't show them.
- **The fullscreen layout, if you want to click.** Thumbnails show up either way, but Claude Code only sends mouse clicks to mods in fullscreen. Turn it on by setting `CLAUDE_CODE_NO_FLICKER=1`. To keep it on everywhere, add it to `~/.claude/settings.json`:

  ```json
  {
    "env": {
      "CLAUDE_CODE_NO_FLICKER": "1"
    }
  }
  ```

  Or, to try it out for a single run, put it in front of the command:

  ```bash
  CLAUDE_CODE_NO_FLICKER=1 claude
  ```

  You can also `export CLAUDE_CODE_NO_FLICKER=1` in your shell profile instead. You need this inside tmux too, since Claude Code doesn't go fullscreen there by default.

It only runs in the terminal. Desktop, the IDE extensions and mobile don't load any of it.

## Install

```bash
claude plugin marketplace add parichay28/ai-plugins
claude plugin install image-preview@ai-plugins
```

## Using it

Paste an image and a card with its thumbnail and number appears above the prompt. Hover a card to highlight it, and click it to open the full image in a pane. The pane also shows the image's size, when you pasted it and which session it came from. Press `p` and `n` to flip through the other images in the prompt, and `esc` to close it.

Recalled prompts work too. Press up to bring back a prompt you sent earlier, even from another session in the same project, and you'll see the images that prompt was sent with. A draft you haven't sent keeps its images when you move away from it and come back.

## How it works

Claude Code saves every image you paste to a file in the session's temp folder, `<tmp>/<project>/<session id>/images/<N>.png`. The `N` is the same number you see in `[Image #N]`. `<tmp>` is `$CLAUDE_CODE_TMPDIR` if you've set it, otherwise `/tmp/claude-<your uid>`.

`[Image #1]` doesn't say which session it came from, and every session has its own image 1. The mod works out the owner in one of three ways:

- If the image file was written in the last few seconds, it's a fresh paste in this session.
- If the prompt matches one you sent before, `~/.claude/history.jsonl` says which session sent it.
- If it's a draft the mod has already seen, it keeps the images it had.

When none of these give a clear answer, the mod shows nothing to prevent showing the wrong preview.

Mods don't get an event when you paste or press up, so the mod checks the prompt box five times a second.

## Develop

```bash
claude plugin validate plugins/image-preview
claude plugin test plugins/image-preview
```
