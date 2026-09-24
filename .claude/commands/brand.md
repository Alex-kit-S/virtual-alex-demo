# /brand - Set Up or Refresh Brand Config

Scan brand/ folder. Generate or update brand-config.md and templates based on what's there.

## Flow

1. Check brand/images/ for files. Note any logo, background images.
2. Check brand/templates/ for .pptx and .xlsx files.
3. Check if brand/config/brand-config.md exists.

## If user dropped a new PPT template:
- Open it with python-pptx, extract: colors, fonts, slide dimensions, layout
- Overwrite brand-config.md with extracted brand values
- If no Excel template exists, create one matching the PPT colors and fonts
- Tell user: "Detected your PPT template. Extracted your brand colors and fonts. Generated matching Excel template."

## If user dropped new images but no new templates:
- Ask: "I see new images. What are your brand colors (hex codes) and preferred fonts?"
- Overwrite brand-config.md with their input
- Regenerate template.pptx and template.xlsx using their colors, fonts, and logo
- Tell user: "Generated branded PPT and Excel templates from your colors."

## If user just says "update brand" with nothing new:
- Read current brand-config.md
- Regenerate template.pptx and template.xlsx from current config (in case config was manually edited)

## If nothing exists (fresh install):
- Use the shipped defaults (already in the folder)
- Tell user: "Using default brand. Drop your logo in brand/images/ and a PPT template in brand/templates/, then run /brand again to override."

## Always:
- Overwrite brand/config/brand-config.md with current state
- Ensure template.pptx and template.xlsx exist and match the config
- Tell the user what's active: colors, fonts, logo, templates
- Update vault/log.md
