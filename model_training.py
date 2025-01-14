import requests
from bs4 import BeautifulSoup

# Step 1: Data Collection
url = 'https://sites.google.com/site/dialetdebresa/dizionario-bresciano-italiano'
response = requests.get(url)

def remove_tags(html):
    soup = BeautifulSoup(html, "html.parser")
    for data in soup(['style', 'script']):
        data.decompose()
    return ' '.join(soup.stripped_strings)

def remove_sections(string, sections):
    for section in sections:
        string = string.replace(section, "")
    return string

def remove_parentheses(text):
    while '(' in text and ')' in text:
        start = text.index('(')
        end = text.index(')', start) + 1
        text = text[:start] + text[end:]
    return text

raw_text = remove_tags(response.text)
clean_text = remove_sections(raw_text, ["Dialèt de Brèsa (dialetto bresciano) - Dizionario bresciano-italiano Search this site Embedded Files Skip to main content Skip to navigation Dialèt de Brèsa (dialetto bresciano) Il dialetto bresciano home_bs Home_en Dizionario bresciano-italiano Grammatica Proverbi bresciani, antichi e moderni Toponomastica bresciana Dialèt de Brèsa (dialetto bresciano) Il dialetto bresciano home_bs Home_en Dizionario bresciano-italiano Grammatica Proverbi bresciani, antichi e moderni Toponomastica bresciana More Il dialetto bresciano home_bs Home_en Dizionario bresciano-italiano Grammatica Proverbi bresciani, antichi e moderni Toponomastica bresciana Dizionario bresciano-italiano Dizionario Bresciano-Italiano Ecco un dizionario di base. Aggiungete il vostro vocabolo preferito in commento (o mandate una mail qui ) e verrà aggiunto alla lista. Qui trovate anche: una guida alla pronuncia e all'ortografia vedete qui; un' introduzione al dialetto e al sito , una lista di proverbi bresciani con traduzione in italiano la lista completa e corretta dei i nomi dei comuni bresciani in dialetto . (a piè di pagina l'elenco delle abbreviazioni )",
                                                       "[A] [B] [C] [D] [E] [F] [G] [H] [I] [L] [M] [N] [N] [O] [P] [Q] [R] [S] [T] [U] [V] [Z]",
                                                       "A", "B", "C", "D", "E", "F", "G", "H", "I", "L", "M", "N", "O", "P", "Q", "R", "S", "T", "U", "V", "Z",
                                                       "Nella trascrizione dei termini dialettali si sono usate le regole fonetiche definite per tutti i documenti di questo sito. Tra parentesi sono riportate le descrizioni grammaticali e di utilizzo dei termini, abbreviate secondo il seguente schema: agg. = aggettivo art. = articolo avv. = avverbio cong. = congiunzione det. = determinativo escl. = esclamazione est. = per estensione significa anche fam. = familiare fig. = figurato n.f. = sostantivo maschile n.m. = sostantivo femminile off! = offensivo, da evitare pl. = usato solo al plurale pr. = pronome prep. = preposizione rafforz. = rafforzativo sing. = usato solo al singolare spec. = specialmente usato v.in. = verbo intransitivo v.tr. = verbo transitivo ! = molto volgare, da evitare ~ = sostituisce la parola definita (c) 1998-2013 Marco Forzati . Google Sites Report abuse Page details Page updated Google Sites Report abuse",
                                          "ai a: l dialetto bresciano rammatica roverbi bresciani, antichi e moderni oponomastica bresciana ella trascrizione dei termini dialettali si sono usate le regole fonetiche definite per tutti i documenti di questo sito. ra parentesi sono riportate le descrizioni grammaticali e di utilizzo dei termini, abbreviate secondo il seguente schema: agg. = aggettivo art. = articolo avv. = avverbio cong. = congiunzione det. = determinativo escl. = esclamazione est. = per estensione significa anche fam. = familiare fig. = figurato n.f. = sostantivo maschile n.m. = sostantivo femminile off! = offensivo, da evitare pl. = usato solo al plurale pr. = pronome prep. = preposizione rafforz. = rafforzativo sing. = usato solo al singolare spec. = specialmente usato v.in. = verbo intransitivo v.tr. = verbo transitivo ! = molto volgare, da evitare ~ = sostituisce la parola definita 1998-2013 arco orzati . oogle ites eport abuse age details age updated oogle ites eport abuse"])

cleaner_text = remove_sections(' '.join(remove_parentheses(clean_text).split()), ["ai a: l dialetto bresciano rammatica roverbi bresciani, antichi e moderni oponomastica bresciana ella trascrizione dei termini dialettali si sono usate le regole fonetiche definite per tutti i documenti di questo sito. ra parentesi sono riportate le descrizioni grammaticali e di utilizzo dei termini, abbreviate secondo il seguente schema: agg. = aggettivo art. = articolo avv. = avverbio cong. = congiunzione det. = determinativo escl. = esclamazione est. = per estensione significa anche fam. = familiare fig. = figurato n.f. = sostantivo maschile n.m. = sostantivo femminile off! = offensivo, da evitare pl. = usato solo al plurale pr. = pronome prep. = preposizione rafforz. = rafforzativo sing. = usato solo al singolare spec. = specialmente usato v.in. = verbo intransitivo v.tr. = verbo transitivo ! = molto volgare, da evitare ~ = sostituisce la parola definita 1998-2013 arco orzati . oogle ites eport abuse age details age updated oogle ites eport abuse", "ai a: l dialetto bresciano rammatica roverbi bresciani, antichi e moderni oponomastica bresciana"])

print(cleaner_text)

bresciano_words = []
italian_words = []

# # Step 2: Extracting word pairs
# italian_words = []
# bresciano_words = []
#
# for row in rows:
#     cols = row.find_all('td')
#     if len(cols) == 2:
#         italian_words.append(cols[0].get_text().strip())
#         bresciano_words.append(cols[1].get_text().strip())
#
# # Step 3: Creating a DataFrame for side-by-side columns
# df = pd.DataFrame({
#     'Italian': italian_words,
#     'Bresciano': bresciano_words
# })
#
# # Step 4: Saving to a CSV file
# df.to_csv('italian_bresciano_words.csv', index=False)
#
# print("Data saved to italian_bresciano_words.csv")