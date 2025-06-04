let sourceWords = [];
let destinationWords = [];

let targetLanguage = document.getElementById('targetLanguage').value;

document.addEventListener('DOMContentLoaded', function() {
    fetch(`dictionaries/dict_${targetLanguage}.csv`)
        .then(response => response.text())
        .then(data => {
            Papa.parse(data, {
                header: true,
                complete: function(results) {
                    [sourceWords, destinationWords] = convertCSVToArrays(results.data);
                }
            });
        });
});

document.getElementById('targetLanguage').addEventListener('click', function() {
    targetLanguage = document.getElementById('targetLanguage').value;
    fetch(`dictionaries/dict_${targetLanguage}.csv`)
        .then(response => response.text())
        .then(data => {
            Papa.parse(data, {
                header: true,
                complete: function(results) {
                    [sourceWords, destinationWords] = convertCSVToArrays(results.data);
                }
            });
        });
});

function convertCSVToArrays(data) {
    const source = [];
    const destination = [];

    if (targetLanguage === "br") {
        data.forEach(row => {
        source.push(row.Italiano);
        destination.push(row.Bresciano);
        });
    } else if (targetLanguage === "mi") {
        data.forEach(row => {
        source.push(row.Italiano);
        destination.push(row.Milanese);
        });
    }

    return [source, destination];
}

function translateText() {
    const inputText = document.getElementById('inputText').value;
    const wordsWithPunctuation = extractWordsWithPunctuation(inputText);

    const translatedWords = wordsWithPunctuation.map(item => {
        const cleanWord = item.word;
        const index = sourceWords.indexOf(cleanWord.toLowerCase());

        if (index !== -1) {
            const translation = destinationWords[index];
            const translatedWithCaps = preserveCapitalization(cleanWord, translation);
            return translatedWithCaps + item.punctuation;
        }
        return cleanWord + item.punctuation;
    });

    const translation = translatedWords.join(' ');
    document.getElementById('outputText').innerText = translation;
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