concept CarSearch extends Global {
  /* Match the search page */
  match '*/zoeken*' 

  /* Retrieve search parameter */
  val searchParameter = `getSearchParameter()`
  
  /* Flow that gathers information on cars based on the license plate if that was the input of the search */
  flow 
    /* Check if the search was for a Dutch license plate */
    => select[`searchParameter.length() == 8 && searchParameter==~/^.*\-.*\-.*$/`@groovy]
    /* Filter based on if it is or not */
    => filter['searchParameter']
    => code[url = `"https://overheid.io/api/voertuiggegevens/"+searchParameter+"?ovio-api-key=221ed3e47ae357f95b78b52b4ed55dc7622ba39af048f9674cb0026c3143af72"`@groovy]
    => http[url='@url',method='GET', headers = 'Accept: application/json']
    => code[Kleur = `getParam(result,"eerstekleur")`@groovy,
            Naam = `getParam(result,"handelsbenaming")`@groovy,
            sbID = `'cf1c2c110d04fb997985bac277db13a5'`@groovy,
            TimeStamp = `new Date().toJSON().split('T')[0]+' '+new Date().toJSON().split('T')[1].substring(0,8)`
            ]
    => filter['Kleur', 'Naam', 'sbID','TimeStamp', 'searchParameter']
    /* Insert information into the Cars table of the database */
    => sql["INSERT INTO `Cars` (`sandbox_id`, `timestamp`, `license_plate`, `name`) VALUES (:sbID, :TimeStamp, :searchParameter, :Naam)", `dataSource`]
    => debug

    /* Returns a parameter from the URL */
    def getParam  = {str, param => `
    if (str.indexOf('"'+param+'":"')>-1) {
        String temp = str.split('"'+param+'":"')[1]
        return temp.split('"')[0]
    } else if (str.indexOf('"'+param+'":')>-1) {
        String temp = str.split('"'+param+'":')[1]
        return temp.split(',')[0]
    } else {
        return ""
    }
    `@groovy}
}

/* 
 * The REST api that we use. To access it, use this:
 * curl -H "Content-Type:application/json" --referrer https://www.tue.nl/restapi?dimml=sandbox/7d5f1a40133293e9290eb39069b41f773d2a41eb 
 * http://baltar-dev.dimml.io/{endpointName}?ShowOnlyLastWeek={0,1}
 */
concept API {
    match '*restapi*'

    /* Define API Routes */
    plugin rest " 
        /getCars => getCars
        /getPageFlow => getPageFlow
        /getSources => getSources
        /getPages => getPages
    "
}

/* Information regarding the database */
const dataSource = `{
    type: 'mysql',
    port: 3306,
    serverName: 'dimmldemo.o2mc.io',
    databaseName: 'dimmldemo',
    user: 'dimmlwa',
    password: '2YN0nWU4z3Eo'
}`

/* Information regarding the predictions. */
const features = `{
    category:['home','studeren','onderzoek','innoveren','universiteit'],
    search:['0','1']
}`

concept Global {
    /* Match every URL */
    match '*'
  
    /* Retrieve page information */
    val url = `window.location.href`
    val previousUrl = `document.referrer`
    val pageName = `getPageName()`
    val visitorId = `localStorage.dimmlcid=localStorage.dimmlcid||guid()`
    val SessionId = `sessionStorage.dimmlcid=sessionStorage.dimmlcid||guid()`
    val sandboxId = 'cf1c2c110d04fb997985bac277db13a5'
    val timeOfDay = `new Date().toJSON().split('T')[1].substring(0,8)`
    val date = `new Date().toJSON().split('T')[0]`
    val timeStamp = `new Date().toJSON().split('T')[0]+' '+new Date().toJSON().split('T')[1].substring(0,8)`
    val title = `document.title`
    val referrer = `getReferrerHostname()`
    val language = `getLanguageLink().innerText==="NEDERLANDS"?"en":"nl"`
    val pageCategory = `getPageName().split('/')[0]`
    val marketingCampaign = `getMarketingCampaign()`

    /* Flow that gathers information for and inserts it into the PageFlow table of the database */
    flow
        => ip
        => session['SessionId',
            Visit = `(session[pageName] = (session[pageName]?:0).toLong()+1)==1?1:0`@groovy,
            PagePath = `(session.pagepath=(session.pagepath?:[]))<<pageName`@groovy,
            /* If not yet defined then assign current date and time to startofsession */
            StartOfVisit = `session.startofvisit=session.startofvisit?:timeStamp`@groovy
        ]
        => script
        => sql["INSERT INTO `PageFlow` (`sandbox_id`, `timestamp`, `visit_start`, `seq_nr`, `url`, `previous_url`) VALUES(:sandboxId, :timeStamp, :StartOfVisit, :Visit, :url, :previousUrl)", `dataSource`]

    /* Flow that inserts information into the Sources table of the database */
    flow
        => sql["INSERT INTO `Sources` (`sandbox_id`, `timestamp`, `referrer_domain`, `campaign`) VALUES (:sandboxId, :timeStamp, :referrer, :marketingCampaign)", `dataSource`]
    
    /* Flow that inserts information into the Pages table of the database */
    flow
        => sql["INSERT INTO `Pages` (`sandbox_id`, `timestamp`, `url`, `page_title`, `page_category`, `time`, `date`) VALUES (:sandboxId, :timeStamp, :url, :pageName, :pageCategory, :timeOfDay, :date)", `dataSource`]
  
    val category = `new URL(document.referrer).pathname.split('/')[1]`
    val search = `/\/zoeken/.test(document.location.pathname)?'1':'0'`
  
    /* Flow that learns the search activity */
    flow
        => moa:naivebayes[model = `features`, class = 'search']
  
    /* Flow that predicts if a user is going to search */
    flow
        => code[orgSearch = `search`@groovy, search=`1`@groovy, category=`pageCategory`@groovy]
        => moa:classify[model = `features`]
        => debug
    
    /* Flow that exports all data to debug */
    flow
        => debug
    
    plugin script `console.log( 'Web analytics example' )`
    plugin session
    plugin debug
}

/* Defines a random sequence */
def guid = `dimml.sha1(+new Date()+Math.random().toString(36).slice(2)+navigator.userAgent).slice(20)`

/* Function that returns page name */
def getPageName = `(location.pathname||'/home').substring(1)`

/* Retrieves what term was searched for on the TU/e website */
def getSearchParameter = `
    var regex = new RegExp("[\\?&]" + 'q' + "=([^&#]*)"),
    results = regex.exec(location.search);
    return results === null ? "" : decodeURIComponent(results[1].replace(/\+/g, " "));`

/* Retrieves only the host name and not the entire last visited URL */
def getReferrerHostname = `new URL(document.referrer).hostname`

/* Looks at what domain the referrer come from and assigns value based on that */
def getMarketingCampaign = `
    var referrer = document.referrer;
    if (referrer === "")
        return "Direct";
    var hostnameParts = getReferrerHostname().split('.');
    var domain = hostnameParts[hostnameParts.length-2];
    switch(domain) {
        case "google":
        case "bing":
        case "yahoo":
            return "SEO";
        case "facebook":
            return "Facebook";
        case "tue":
            return "Internal";
        default:
            return "Other";
    }`

/* The method that shows the cars that are saved on the database with our API key */
concept getCars {
    plugin rest:json[flowName = 'json']

     flow (json)
        => code [ShowOnlyLastWeek = `ShowOnlyLastWeek?ShowOnlyLastWeek:'0'`@groovy]
     /*
      * First creates a unix time timestamp. Then:
      * If it should show only the data from last week it compares the current timestamp to the one of one week ago for all Car data in the database. If it is larger or equal to that it shows them for the given sandbox_id.
      * If it should show all data it returns all Car data that belongs to the given sandbox_id. 
      */
        => sql["SELECT * FROM `Cars` WHERE ((FROM_UNIXTIME(UNIX_TIMESTAMP(`timestamp`)) >= DATE(NOW()) - INTERVAL 7 DAY AND :ShowOnlyLastWeek = '1') OR (:ShowOnlyLastWeek = '0')) AND `sandbox_id`='cf1c2c110d04fb997985bac277db13a5'",`dataSource`,limit='100',batch='1'] 
        => out
}

/* The method that shows the page flow that are saved on the database with our API key */
concept getPageFlow {
    plugin rest:json[flowName = 'json']

     flow (json)
     => code [ShowOnlyLastWeek = `ShowOnlyLastWeek?ShowOnlyLastWeek:'0'`@groovy]
     //Works the same way as the similar Cars sql query. 
     => sql["SELECT * FROM `PageFlow` WHERE ((FROM_UNIXTIME(UNIX_TIMESTAMP(`timestamp`)) >= DATE(NOW()) - INTERVAL 7 DAY AND :ShowOnlyLastWeek = '1') OR (:ShowOnlyLastWeek = '0')) AND `sandbox_id`='cf1c2c110d04fb997985bac277db13a5'",`dataSource`,limit='100',batch='1'] 
     => expand['result']
     => out
}

/* The method that shows all page sources that are saved on the database with our API key */
concept getSources {
    plugin rest:json[flowName = 'json']

     flow (json)
     => code [ShowOnlyLastWeek = `ShowOnlyLastWeek?ShowOnlyLastWeek:'0'`@groovy]
     //Works the same way as the similar Cars sql query. 
     => sql["SELECT * FROM `Sources` WHERE ((FROM_UNIXTIME(UNIX_TIMESTAMP(`timestamp`)) >= DATE(NOW()) - INTERVAL 7 DAY AND :ShowOnlyLastWeek = '1') OR (:ShowOnlyLastWeek = '0')) AND `sandbox_id`='cf1c2c110d04fb997985bac277db13a5'",`dataSource`,limit='100',batch='1'] 
     => expand['result']
     => out
}

/* The method that shows all pages that are saved on the database with our API key */
concept getPages {
    plugin rest:json[flowName = 'json']

     flow (json)
     => code [ShowOnlyLastWeek = `ShowOnlyLastWeek?ShowOnlyLastWeek:'0'`@groovy]
     //Works the same way as the similar Cars sql query. 
     => sql["SELECT * FROM `Pages` WHERE ((FROM_UNIXTIME(UNIX_TIMESTAMP(`timestamp`)) >= DATE(NOW()) - INTERVAL 7 DAY AND :ShowOnlyLastWeek = '1') OR (:ShowOnlyLastWeek = '0')) AND `sandbox_id`='cf1c2c110d04fb997985bac277db13a5'",`dataSource`,limit='100',batch='1'] 
     => expand['result']
     => out
}
