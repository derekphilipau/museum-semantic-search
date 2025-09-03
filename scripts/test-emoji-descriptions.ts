#!/usr/bin/env node
import { loadEnvConfig } from '@next/env';
import * as path from 'path';
import { generateVisualDescription } from '../lib/descriptions/gemini';

// Load environment variables
const projectDir = path.join(__dirname, '..');
loadEnvConfig(projectDir);

async function testEmojiDescriptions() {
  console.log('Testing Visual Description Generation with Emojis\n');
  
  // Test with a sample image (you'll need to provide an actual image path)
  const testImagePath = process.argv[2];
  
  if (!testImagePath) {
    console.error('Please provide an image path as argument');
    console.log('Usage: npx tsx scripts/test-emoji-descriptions.ts /path/to/image.jpg');
    process.exit(1);
  }
  
  try {
    console.log(`Generating description for: ${testImagePath}\n`);
    const result = await generateVisualDescription(testImagePath);
    
    console.log('=== ALT TEXT ===');
    console.log(result.descriptions.altText);
    console.log(`(${result.descriptions.altText.split(' ').length} words)\n`);
    
    console.log('=== EMOJI SUMMARY ===');
    console.log(result.descriptions.emojiSummary);
    console.log(`(${result.descriptions.emojiSummary.length} characters)\n`);
    
    console.log('=== LONG DESCRIPTION ===');
    console.log(result.descriptions.longDescription.substring(0, 200) + '...');
    console.log(`(${result.descriptions.longDescription.split(' ').length} words)\n`);
    
    console.log('✅ Success! Emoji summaries are working correctly.');
    
    // Check for accessibility compliance
    const hasPersonEmojis = /👤|👥|👨|👩|👶|👧|👦|👴|👵|🧑|👮|👷|💂|🕵|👳|👱|🧔|👸|🤴/.test(result.descriptions.emojiSummary);
    const hasFaceEmojis = /😀|😃|😄|😁|😊|😇|🙂|😉|😌|😍|🥰|😘|😗|😙|😚|😋|😛|😜|🤪|😝|🤑|🤗|🤭|🤫|🤔|🤐|😐|😑|😶|😏|😒|🙄|😬|🤥|😌|😔|😪|🤤|😴|😷|🤒|🤕|🤢|🤮|🤧|😵|🤯|🤠|😎|🤓|🧐|😕|😟|🙁|☹️|😮|😯|😲|😳|😦|😧|😨|😰|😥|😢|😭|😱|😖|😣|😞|😓|😩|😫|🥱|😤|😡|😠|🤬|😈|👿|💀|☠️|💩|🤡|👹|👺|👻|👽|👾|🤖|😺|😸|😹|😻|😼|😽|🙀|😿|😾/.test(result.descriptions.emojiSummary);
    
    if (hasPersonEmojis || hasFaceEmojis) {
      console.warn('⚠️  Warning: Emoji summary contains person/face emojis which should be avoided for accessibility');
    } else {
      console.log('✅ Emoji summary follows accessibility guidelines (no person/face emojis)');
    }
    
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testEmojiDescriptions();