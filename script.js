let wordDict = new Map();
let sentenceDict = new Map();
let phraseMatcher = [];

document.addEventListener('DOMContentLoaded', function() {
    // Load word dictionary
    fetch('dict.csv')
        .then(response => response.text())
        .then(data => {
            Papa.parse(data, {
                header: true,
                complete: function(results) {
                    loadWordDictionary(results.data);
                }
            });
        });
    // Load sentence/phrase dictionary
    fetch('sentence_dict.csv')
        .then(response => response.text())
        .then(data => {
            Papa.parse(data, {
                header: true,
                complete: function(results) {
                    loadSentenceDictionary(results.data);
                }
            });
        });
});

function loadWordDictionary(data) {
    data.forEach(row => {
        if (row.Italiano && row.Bresciano) {
            wordDict.set(row.Italiano.toLowerCase().trim(), row.Bresciano.trim());
        }
    });
}

function loadSentenceDictionary(data) {
    data.forEach(row => {
        if (row.Italiano && row.Bresciano) {
            const italian = row.Italiano.trim();
            const bresciano = row.Bresciano.trim();
            sentenceDict.set(italian.toLowerCase(), bresciano);
            
            // Create phrase matcher entries for partial matches
            phraseMatcher.push({
                italian: italian.toLowerCase(),
                bresciano: bresciano,
                words: italian.toLowerCase().split(/\s+/)
            });
        }
    });
    
    // Sort phrase matcher by length (longest first) for better matching
    phraseMatcher.sort((a, b) => b.words.length - a.words.length);
}

function translateText() {
    const inputText = document.getElementById('inputText').value.trim();
    const targetLanguage = document.getElementById('targetLanguage').value;

    if (!inputText) {
        document.getElementById('outputText').innerText = '';
        return;
    }

    if (targetLanguage === 'br') {
        const translation = translateToDialect(inputText);
        document.getElementById('outputText').innerText = translation;
    }
}

function translateToDialect(text) {
    // Normalize input text
    const normalizedText = text.toLowerCase().trim();
    
    // First, try exact sentence match
    if (sentenceDict.has(normalizedText)) {
        return sentenceDict.get(normalizedText);
    }
    
    // Split into sentences
    const sentences = text.split(/[.!?]+/).filter(s => s.trim().length > 0);
    const translatedSentences = [];
    
    for (let sentence of sentences) {
        const translatedSentence = translateSentence(sentence.trim());
        translatedSentences.push(translatedSentence);
    }
    
    return translatedSentences.join('. ');
}

function translateSentence(sentence) {
    if (!sentence) return '';
    
    const normalizedSentence = sentence.toLowerCase();
    
    // Check for exact sentence match
    if (sentenceDict.has(normalizedSentence)) {
        return sentenceDict.get(normalizedSentence);
    }
    
    // Try phrase-based translation
    let result = translateWithPhrases(sentence);
    
    // If no phrase matches found, fall back to word-by-word translation
    if (result === sentence) {
        result = translateWordByWord(sentence);
    }
    
    return result;
}

function translateWithPhrases(sentence) {
    let result = sentence;
    let words = sentence.toLowerCase().split(/\s+/);
    let translated = new Array(words.length).fill(false);
    let translatedWords = [...words];
    
    // Try to match phrases from longest to shortest
    for (let phrase of phraseMatcher) {
        const phraseLength = phrase.words.length;
        
        for (let i = 0; i <= words.length - phraseLength; i++) {
            // Skip if any word in this position is already translated
            if (translated.slice(i, i + phraseLength).some(t => t)) {
                continue;
            }
            
            // Check if phrase matches
            const candidatePhrase = words.slice(i, i + phraseLength);
            if (arraysEqual(candidatePhrase, phrase.words)) {
                // Mark words as translated
                for (let j = i; j < i + phraseLength; j++) {
                    translated[j] = true;
                }
                
                // Replace with translation
                const translationWords = phrase.bresciano.split(/\s+/);
                translatedWords.splice(i, phraseLength, ...translationWords);
                
                // Adjust arrays for length difference
                if (translationWords.length !== phraseLength) {
                    const diff = translationWords.length - phraseLength;
                    if (diff > 0) {
                        // Insert additional translated flags
                        translated.splice(i, phraseLength, ...new Array(translationWords.length).fill(true));
                    } else {
                        // Remove excess translated flags
                        translated.splice(i, phraseLength, ...new Array(translationWords.length).fill(true));
                    }
                    words.splice(i, phraseLength, ...translationWords);
                }
                break;
            }
        }
    }
    
    // Translate remaining individual words
    for (let i = 0; i < translatedWords.length; i++) {
        if (!translated[i]) {
            const word = words[i] || translatedWords[i];
            const cleanWord = word.replace(/[^\w]/g, '');
            if (wordDict.has(cleanWord.toLowerCase())) {
                translatedWords[i] = wordDict.get(cleanWord.toLowerCase());
            }
        }
    }
    
    return translatedWords.join(' ');
}

function translateWordByWord(sentence) {
    // Preserve punctuation and capitalization
    const words = sentence.split(/(\s+|[^\w\s])/);
    
    return words.map(word => {
        // Skip whitespace and punctuation
        if (/^\s+$/.test(word) || /^[^\w\s]+$/.test(word)) {
            return word;
        }
        
        const cleanWord = word.replace(/[^\w]/g, '');
        const lowerWord = cleanWord.toLowerCase();
        
        if (wordDict.has(lowerWord)) {
            const translation = wordDict.get(lowerWord);
            // Preserve original capitalization pattern
            return preserveCapitalization(word, translation);
        }
        
        return word;
    }).join('');
}

function preserveCapitalization(original, translation) {
    if (!original || !translation) return translation;
    
    if (original[0] === original[0].toUpperCase()) {
        return translation.charAt(0).toUpperCase() + translation.slice(1);
    }
    
    return translation;
}

function arraysEqual(arr1, arr2) {
    if (arr1.length !== arr2.length) return false;
    return arr1.every((val, i) => val === arr2[i]);
}

// Add input event listener for real-time translation (optional)
document.addEventListener('DOMContentLoaded', function() {
    const inputText = document.getElementById('inputText');
    if (inputText) {
        inputText.addEventListener('input', function() {
            // Debounce translation for better performance
            clearTimeout(this.translationTimeout);
            this.translationTimeout = setTimeout(() => {
                translateText();
            }, 500);
        });
    }
});