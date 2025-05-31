let italianoWords = [];
let brescianoWords = [];

document.addEventListener('DOMContentLoaded', function() {
    fetch('dict.csv')
        .then(response => response.text())
        .then(data => {
            Papa.parse(data, {
                header: true,
                complete: function(results) {
                    [italianoWords, brescianoWords] = convertCSVToArrays(results.data);
                }
            });
        });
});

function convertCSVToArrays(data) {
    const italiano = [];
    const bresciano = [];

    data.forEach(row => {
        italiano.push(row.Italiano);
        bresciano.push(row.Bresciano);
    });

    return [italiano, bresciano];
}

function translateText() {
    const inputText = document.getElementById('inputText').value;
    const targetLanguage = document.getElementById('targetLanguage').value;

    if (targetLanguage === 'br') {
        const wordsWithPunctuation = extractWordsWithPunctuation(inputText);

        const translatedWords = wordsWithPunctuation.map(item => {
            const cleanWord = item.word;
            const index = italianoWords.indexOf(cleanWord.toLowerCase());

            if (index !== -1) {
                const translation = brescianoWords[index];
                const translatedWithCaps = preserveCapitalization(cleanWord, translation);
                return translatedWithCaps + item.punctuation;
            }
            return cleanWord + item.punctuation;
        });

        const translation = translatedWords.join(' ');
        document.getElementById('outputText').innerText = translation;
    }
}

function extractWordsWithPunctuation(text) {
    const words = text.split(/\s+/);
    const punctuationRegex = /[,".?!;:]+$/;

    return words.map(word => {
        const punctuationMatch = word.match(punctuationRegex);
        const punctuation = punctuationMatch ? punctuationMatch[0] : '';
        const cleanWord = word.replace(punctuationRegex, '');

        return {
            word: cleanWord,
            punctuation: punctuation
        };
    });
}

function preserveCapitalization(original, translation) {
    if (!original || !translation){
        return translation;
    }
    if (original === original.toUpperCase()) {
        return translation.toUpperCase();
    }
    if (original[0] === original[0].toUpperCase()) {
        return translation.charAt(0).toUpperCase() + translation.slice(1);
    }

    return translation;
}